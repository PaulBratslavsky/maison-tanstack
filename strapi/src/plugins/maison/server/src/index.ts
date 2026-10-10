import config from './config';

// The plugin's server entry. Only the config is real so far. Each other part is added by a later task.
export default {
  register() {},
  bootstrap() {},
  destroy() {},
  config,
  contentTypes: {},
  services: {},
  controllers: {},
  routes: [],
  policies: {},
  middlewares: {},
};
