import WebSocket from "ws";
import crypto from "node:crypto";

/**
 * 阿里云百炼 Paraformer 实时语音识别（paraformer-realtime-v2）WebSocket 客户端。
 * 协议：连接 -> run-task -> task-started -> 二进制 PCM(16k/16bit/mono) ->
 * result-generated(sentence_end 标记整句) -> finish-task -> task-finished
 */
export interface ASRCallbacks {
  onReady: () => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string) => void;
  onClosed: () => void;
}

const ASR_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

export class ASRSession {
  private ws: WebSocket;
  private taskId = crypto.randomUUID().replace(/-/g, "");
  private started = false;
  private closed = false;
  private queue: Buffer[] = [];

  constructor(apiKey: string, private cb: ASRCallbacks) {
    this.ws = new WebSocket(ASR_URL, {
      headers: { Authorization: `bearer ${apiKey}` },
    });
    this.ws.on("open", () => this.runTask());
    this.ws.on("message", (data) => this.onMessage(data));
    this.ws.on("error", (e) => this.cb.onError(`ASR 连接错误: ${e.message}`));
    this.ws.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.cb.onClosed();
      }
    });
  }

  private runTask() {
    this.ws.send(
      JSON.stringify({
        header: {
          action: "run-task",
          task_id: this.taskId,
          streaming: "duplex",
        },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: "paraformer-realtime-v2",
          parameters: {
            sample_rate: 16000,
            format: "pcm",
            disfluency_removal_enabled: false,
            language_hints: ["zh"],
          },
          input: {},
        },
      })
    );
  }

  private onMessage(data: WebSocket.RawData) {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const event = msg?.header?.event;
    if (event === "task-started") {
      this.started = true;
      this.cb.onReady();
      for (const buf of this.queue) this.ws.send(buf);
      this.queue = [];
    } else if (event === "result-generated") {
      const sentence = msg?.payload?.output?.sentence;
      if (!sentence) return;
      const text: string = sentence.text ?? "";
      if (!text) return;
      if (sentence.sentence_end) this.cb.onFinal(text);
      else this.cb.onPartial(text);
    } else if (event === "task-failed") {
      this.cb.onError(`ASR 任务失败: ${msg?.header?.error_message ?? "unknown"}`);
      this.close();
    } else if (event === "task-finished") {
      this.close();
    }
  }

  sendAudio(chunk: Buffer) {
    if (this.closed) return;
    if (this.started && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    } else {
      this.queue.push(chunk);
      if (this.queue.length > 200) this.queue.shift(); // 最多缓存 ~10s
    }
  }

  finish() {
    if (this.closed) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            header: { action: "finish-task", task_id: this.taskId, streaming: "duplex" },
            payload: { input: {} },
          })
        );
        setTimeout(() => this.close(), 3000); // 等待 final 结果，兜底关闭
        return;
      }
    } catch {}
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {}
    this.cb.onClosed();
  }
}
