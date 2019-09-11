const get = require('lodash.get');
const { Ignore, IgnoreWithWarning, Fail } = require('./UnauthorizedCacheControlHeaderStrategy');

const DEFAULT_CACHE_CLUSTER_SIZE = '0.5';
const DEFAULT_THROTTLING_BURST_LIMIT = 5000;
const DEFAULT_THROTTLING_RATE_LIMIT = 10000;
const DEFAULT_METRICS_ENABLED = false;
const DEFAULT_DATA_ENCRYPTED = false;
const DEFAULT_TTL = 3600;
const DEFAULT_LOGGING = {
  enabled: false,
  dataTrace: false,
  loggingLevel: 'OFF',
}
const DEFAULT_UNAUTHORIZED_INVALIDATION_REQUEST_STRATEGY = IgnoreWithWarning;

const validLoggingLevels = ['OFF', 'ERROR', 'INFO'];

const mapUnauthorizedRequestStrategy = strategy => {
  if (!strategy) {
    return DEFAULT_UNAUTHORIZED_INVALIDATION_REQUEST_STRATEGY;
  }
  switch (strategy.toLowerCase()) {
    case 'ignore': return Ignore;
    case 'ignorewithwarning': return IgnoreWithWarning;
    case 'fail': return Fail;
    default: return DEFAULT_UNAUTHORIZED_INVALIDATION_REQUEST_STRATEGY;
  }
}

const isApiGatewayEndpoint = event => {
  return event.http ? true : false;
}

class PerKeyInvalidationSettings {
  constructor(cachingSettings) {
    let { perKeyInvalidation } = cachingSettings;
    if (!perKeyInvalidation) {
      this.requireAuthorization = true;
      this.handleUnauthorizedRequests = DEFAULT_UNAUTHORIZED_INVALIDATION_REQUEST_STRATEGY;
    }
    else {
      this.requireAuthorization = perKeyInvalidation.requireAuthorization
      if (perKeyInvalidation.requireAuthorization) {
        this.handleUnauthorizedRequests =
          mapUnauthorizedRequestStrategy(perKeyInvalidation.handleUnauthorizedRequests);
      }
    }
  }
}

class ApiGatewayEndpointCachingSettings {
  constructor(customFunctionName, functionName, event, globalSettings) {
    this.customFunctionName = customFunctionName;
    this.functionName = functionName;

    if (typeof (event.http) === 'string') {
      let parts = event.http.split(' ');
      this.method = parts[0];
      this.path = parts[1];
    }
    else {
      this.path = event.http.path;
      this.method = event.http.method;
    }

    if (!event.http.caching) {
      this.cachingEnabled = false;
      return;
    }
    let cachingConfig = event.http.caching;
    this.cachingEnabled = globalSettings.cachingEnabled ? cachingConfig.enabled : false;
    this.dataEncrypted = cachingConfig.dataEncrypted || globalSettings.dataEncrypted;
    this.cacheTtlInSeconds = cachingConfig.ttlInSeconds || globalSettings.cacheTtlInSeconds;
    this.cacheKeyParameters = cachingConfig.cacheKeyParameters;

    if (!cachingConfig.perKeyInvalidation) {
      this.perKeyInvalidation = globalSettings.perKeyInvalidation;
    } else {
      this.perKeyInvalidation = new PerKeyInvalidationSettings(cachingConfig);
    }
  }
}

class ApiGatewayCachingSettings {
  constructor(serverless, options) {
    if (!get(serverless, 'service.custom.apiGateway')) {
      return;
    }
    this.cachingEnabled = serverless.service.custom.apiGateway.cachingEnabled;
    this.apiGatewayIsShared = serverless.service.custom.apiGateway.apiGatewayIsShared;
    this.logging = serverless.service.custom.apiGateway.logging || DEFAULT_LOGGING;
    this.validateLoggingObject();
    this.loggingEnabled = this.logging.enabled;
    this.throttlingBurstLimit = serverless.service.custom.apiGateway.throttlingBurstLimit || DEFAULT_THROTTLING_BURST_LIMIT;
    this.throttlingRateLimit = serverless.service.custom.apiGateway.throttlingRateLimit || DEFAULT_THROTTLING_RATE_LIMIT;
    this.metricsEnabled = serverless.service.custom.apiGateway.metricsEnabled || DEFAULT_METRICS_ENABLED;

    if (options) {
      this.stage = options.stage || serverless.service.provider.stage;
      this.region = options.region || serverless.service.provider.region;
    } else {
      this.stage = serverless.service.provider.stage;
      this.region = serverless.service.provider.region;
    }

    this.endpointSettings = [];

    this.cacheClusterSize = serverless.service.custom.apiGateway.clusterSize || DEFAULT_CACHE_CLUSTER_SIZE;
    this.cacheTtlInSeconds = serverless.service.custom.apiGateway.ttlInSeconds || DEFAULT_TTL;
    this.dataEncrypted = serverless.service.custom.apiGateway.dataEncrypted || DEFAULT_DATA_ENCRYPTED;

    this.perKeyInvalidation = new PerKeyInvalidationSettings(serverless.service.custom.apiGateway);

    for (let functionName in serverless.service.functions) {
      let functionSettings = serverless.service.functions[functionName];
      for (let event in functionSettings.events) {
        if (isApiGatewayEndpoint(functionSettings.events[event])) {
          this.endpointSettings.push(new ApiGatewayEndpointCachingSettings(functionSettings.name, functionName, functionSettings.events[event], this))
        }
      }
    }
  }

  validateLoggingObject() {
    this.logging.enabled = this.logging.enabled !== null || this.logging.enabled !== undefined ? this.logging.enabled : false;
    this.logging.dataTrace = this.logging.dataTrace || DEFAULT_LOGGING.dataTrace;
    if (!this.logging.loggingLevel || validLoggingLevels.indexOf(this.logging.loggingLevel) === -1) {
      this.logging.loggingLevel = DEFAULT_LOGGING.dataTrace;
    }
    
  }
}

module.exports = ApiGatewayCachingSettings
