import bootstrap from './bootstrap';
import config from './config';
import contentTypes from './content-types';
import register from './register';
import services from './services';

// The plugin's server entry. The config, the content types, the document middleware, the services and the bootstrap
// work that needs only services are real so far. Each other part is added by a later task.
export default {
  register,
  bootstrap,
  destroy() {},
  config,
  contentTypes,
  services,
  controllers: {},
  routes: [],
  policies: {},
  middlewares: {},
};
