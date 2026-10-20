import { retryNotifications } from '../lib/notification-worker.js';
console.log(await retryNotifications({channel:'email'}));
