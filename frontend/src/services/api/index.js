import ApiClient from './client.js';
import * as authMethods from './auth.js';
import * as appMethods from './apps.js';
import * as dockerMethods from './docker.js';
import * as databaseMethods from './databases.js';
import * as serverMethods from './servers.js';
import * as wordpressMethods from './wordpress.js';
import * as systemMethods from './system.js';
import * as securityMethods from './security.js';
import * as fileMethods from './files.js';
import * as dnsMethods from './dns.js';
import * as pluginMethods from './plugins.js';
import * as deploymentJobMethods from './deploymentJobs.js';
import * as pairingMethods from './pairing.js';
import * as sourceConnectionMethods from './sourceConnections.js';
import * as connectionMethods from './connections.js';
import * as aiMethods from './ai.js';
import * as tunnelMethods from './tunnels.js';
import * as secretsWebhooksMethods from './secretsWebhooks.js';
import * as containerOpsMethods from './containerOps.js';

class ApiService extends ApiClient {
    constructor() {
        super();
        // Bind all methods from domain modules to this instance
        const modules = [
            authMethods,
            appMethods,
            dockerMethods,
            databaseMethods,
            serverMethods,
            wordpressMethods,
            systemMethods,
            securityMethods,
            fileMethods,
            dnsMethods,
            pluginMethods,
            deploymentJobMethods,
            pairingMethods,
            sourceConnectionMethods,
            connectionMethods,
            aiMethods,
            tunnelMethods,
            secretsWebhooksMethods,
            containerOpsMethods,
        ];
        for (const mod of modules) {
            for (const [key, fn] of Object.entries(mod)) {
                if (typeof fn === 'function') {
                    this[key] = fn.bind(this);
                }
            }
        }
    }
}

export const api = new ApiService();
export default api;
