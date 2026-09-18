/** Emits ordered OpenAI Responses SSE events while tracking opened output items. */
export type ResponseEmitter = (event: string, data: Record<string, unknown>) => void;

export class ResponseEventWriter {
  reasoningOpened = false;
  messageOpened = false;
  private sequence = 0;

  constructor(
    private readonly emitEvent: ResponseEmitter | undefined,
    private readonly reasoningId: string,
    private readonly messageId: string,
  ) {}

  emit(event: string, data: Record<string, unknown>): void {
    this.emitEvent?.(event, { ...data, sequence_number: this.sequence++ });
  }

  start(response: unknown): void {
    this.emit("response.created", { type: "response.created", response });
    this.emit("response.in_progress", { type: "response.in_progress", response });
  }

  emitReasoningDelta(delta: string): void {
    this.ensureReasoning();
    this.emit("response.reasoning_text.delta", {
      type: "response.reasoning_text.delta",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      delta,
    });
  }

  emitOutputDelta(delta: string): void {
    this.ensureMessage();
    this.emit("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: this.messageId,
      output_index: this.reasoningOpened ? 1 : 0,
      content_index: 0,
      delta,
    });
  }

  finishReasoning(text: string, output: Array<Record<string, unknown>>): void {
    if (!this.reasoningOpened) return;
    this.emit("response.reasoning_text.done", {
      type: "response.reasoning_text.done",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      text,
    });
    const item = {
      type: "reasoning",
      id: this.reasoningId,
      summary: [{ type: "summary_text", text }],
      content: [{ type: "reasoning_text", text }],
    };
    output.push(item);
    this.emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item,
    });
  }

  finishMessage(text: string, output: Array<Record<string, unknown>>): void {
    if (!this.messageOpened) return;
    const outputIndex = output.length;
    this.emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: this.messageId,
      output_index: outputIndex,
      content_index: 0,
      text,
    });
    this.emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: this.messageId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text },
    });
    const item = {
      type: "message",
      id: this.messageId,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text }],
    };
    output.push(item);
    this.emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    });
  }

  emitFunctionCall(item: Record<string, unknown>, outputIndex: number): void {
    this.emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { ...item, arguments: "", status: "in_progress" },
    });
    this.emit("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: item.id,
      output_index: outputIndex,
      delta: item.arguments,
    });
    this.emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: item.id,
      output_index: outputIndex,
      arguments: item.arguments,
    });
    this.emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    });
  }

  private ensureReasoning(): void {
    if (this.reasoningOpened) return;
    this.reasoningOpened = true;
    this.emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: this.reasoningId, summary: [], content: [] },
    });
    this.emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: this.reasoningId,
      output_index: 0,
      content_index: 0,
      part: { type: "reasoning_text", text: "" },
    });
  }

  private ensureMessage(): void {
    if (this.messageOpened) return;
    this.messageOpened = true;
    const outputIndex = this.reasoningOpened ? 1 : 0;
    this.emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { type: "message", id: this.messageId, role: "assistant", status: "in_progress", content: [] },
    });
    this.emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: this.messageId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "" },
    });
  }
}
