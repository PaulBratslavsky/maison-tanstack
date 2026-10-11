import bootstrap from './bootstrap';
import config from './config';
import contentTypes from './content-types';
import controllers from './controllers';
import policies from './policies';
import register from './register';
import routes from './routes';
import services from './services';

// The plugin's server entry.
export default {
  register,
  bootstrap,
  destroy() {},
  config,
  contentTypes,
  services,
  controllers,
  routes,
  policies,
  middlewares: {},
};
