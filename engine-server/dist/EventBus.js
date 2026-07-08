"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
class EventBusImpl {
    subscribers = {};
    // 이벤트 채널을 구독합니다.
    subscribe(channel, callback) {
        if (!this.subscribers[channel]) {
            this.subscribers[channel] = [];
        }
        this.subscribers[channel].push(callback);
    }
    // 이벤트를 비동기적으로 브로드캐스팅합니다. O(1)에 가깝게 구독자에게만 전달됩니다.
    publish(channel, event) {
        const callbacks = this.subscribers[channel];
        if (callbacks) {
            // 틱루프를 지연시키지 않기 위해 비동기 큐에 삽입
            setImmediate(() => {
                for (const cb of callbacks) {
                    try {
                        cb(event);
                    }
                    catch (e) {
                        console.error(`[EventBus] Error in subscriber callback for channel ${channel}:`, e);
                    }
                }
            });
        }
    }
}
// 싱글톤 인스턴스
exports.EventBus = new EventBusImpl();
//# sourceMappingURL=EventBus.js.map