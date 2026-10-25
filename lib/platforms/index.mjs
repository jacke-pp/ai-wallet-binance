// Where coins trade, tried in order: the first platform that recognizes a coin handles it.
// LAUNCHPADS: the agent-only launchpads snipes can watch for new coins (key -> { watch: { address, topics, parse } }).
import * as flapagent from './flapagent.mjs';
import * as fouragent from './fouragent.mjs';
import * as gang from './gang.mjs';
import * as selfcurve from './selfcurve.mjs';
import * as flap from './flap.mjs';
import * as pancake from './pancake.mjs';

export const PLATFORMS = [flapagent, fouragent, gang, selfcurve, flap, pancake];
export const LAUNCHPADS = { 'four-agent': fouragent, 'flap-agent': flapagent, gang };
