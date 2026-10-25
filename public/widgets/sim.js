// Adapter: the switch simulator as a widget kind. Config: { sim: "<scenario name>" }.
import { mount as mountSim, SCENARIOS } from '../sim/switch-sim.js';

export const mount = (host, cfg) => mountSim(host, cfg.sim);
export const validate = (cfg) => (SCENARIOS[cfg.sim] ? [] : [`unknown sim scenario "${cfg.sim}"`]);
