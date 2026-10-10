import config from './config';
import contentTypes from './content-types';
import register from './register';

// The plugin's server entry. The config, the content types and the document middleware are real so far. Each other part
// is added by a later task.
export default {
  register,
  bootstrap() {},
  destroy() {},
  config,
  contentTypes,
  services: {},
  controllers: {},
  routes: [],
  policies: {},
  middlewares: {},
};
