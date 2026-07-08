"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const MarketEngine_1 = require("./MarketEngine");
const newsFetcher_1 = require("./newsFetcher");
const EventDirector_1 = require("./EventDirector");
const dotenv = __importStar(require("dotenv"));
const http = __importStar(require("http"));
dotenv.config();
function checkEnv() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error("❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
        process.exit(1);
    }
}
async function main() {
    checkEnv();
    console.log("Initializing Market Engine, News Fetcher, and Event Director...");
    const engine = new MarketEngine_1.MarketEngine();
    const newsFetcher = new newsFetcher_1.NewsFetcher();
    const eventDirector = new EventDirector_1.EventDirector(engine);
    engine.start();
    newsFetcher.start();
    eventDirector.start();
    // Render Web Service용 Dummy HTTP Server (무료 티어 우회용)
    const port = process.env.PORT || 10000;
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Antigravity Stock Engine is running.\n');
    });
    server.listen(port, () => {
        console.log(`✅ Dummy HTTP server listening on port ${port} (for Render Web Service health checks)`);
    });
    // Graceful Shutdown
    const shutdown = () => {
        console.log("\nReceived shutdown signal, stopping systems...");
        engine.stop();
        newsFetcher.stop();
        eventDirector.stop();
        server.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch(err => {
    console.error("Failed to start Market Engine:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map