import {
  type PendingInteraction,
  PendingInteractionLedger,
  type ProviderInteractionDismissReason,
  type ProviderInteractionPort,
} from '../../../core/execution';

interface GeminiQuestionOption {
  readonly description?: string;
  readonly id: string;
  readonly label: string;
}

interface GeminiQuestion {
  readonly allowMultiple: boolean;
  readonly id: string;
  readonly options: readonly GeminiQuestionOption[];
  readonly prompt: string;
}

/**
 * Routes Gemini (`agy acp`) extension requests through feature interaction ports.
 */
export class GeminiExecutionInteractionRouter {
  private sequence = 0;
  private readonly pending: PendingInteractionLedger;

  constructor(
    private readonly interactionPort: ProviderInteractionPort,
    private readonly sessionInstanceId: string,
    private readonly getTurnId: () => string | null,
    private readonly getSessionId: () => string | undefined,
  ) {
    this.pending = new PendingInteractionLedger(interactionPort);
  }

  async handle(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    switch (method) {
      case 'gemini/ask_question':
      case 'agy/ask_question':
        return this.#handleAskQuestion(params, signal);
      default:
        throw new Error(`Unsupported Gemini server request: ${method}`);
    }
  }

  dismissAll(reason: ProviderInteractionDismissReason): void {
    this.pending.dismissAll(reason);
  }

  async #handleAskQuestion(params: unknown, signal?: AbortSignal): Promise<unknown> {
    const turnId = this.getTurnId();
    const request = parseAskQuestionRequest(params);
    if (!turnId || !request || signal?.aborted) {
      return { outcome: 'cancelled' };
    }
    const pending = this.#begin(this.#nextId('question'));
    let dismissReason: ProviderInteractionDismissReason = 'cancelled';
    try {
      const response = await this.interactionPort.askUserQuestion({
        input: {
          questions: request.questions.map((question, index) => ({
            header: `Q${index + 1}`,
            id: question.id,
            multiSelect: question.allowMultiple,
            options: question.options.map(option => ({
              ...(option.description ? { description: option.description } : {}),
              label: option.label,
              value: option.id,
            })),
            question: question.prompt,
          })),
        },
        interactionId: pending.interactionId,
        kind: 'question',
        nativeContext: {
          sessionId: this.getSessionId(),
          toolCallId: request.toolCallId,
        },
        sessionInstanceId: this.sessionInstanceId,
        turnId,
      }, pending.signal);
      if (this.pending.isStaleResponse(pending, response) || this.getTurnId() !== turnId) {
        dismissReason = 'native-rejected';
        return { outcome: 'cancelled' };
      }
      if (!response.answers) {
        return { outcome: 'skipped' };
      }
      dismissReason = 'resolved';
      return {
        answers: buildAskQuestionAnswers(request.questions, response.answers),
        outcome: 'answered',
      };
    } catch {
      return { outcome: 'cancelled' };
    } finally {
      this.pending.settle(pending, dismissReason);
    }
  }

  #nextId(kind: string): string {
    return `${this.sessionInstanceId}:${kind}:${++this.sequence}`;
  }

  #begin(interactionId: string): PendingInteraction {
    this.dismissAll('superseded');
    return this.pending.begin(interactionId)!;
  }
}

function parseAskQuestionRequest(value: unknown): {
  questions: GeminiQuestion[];
  toolCallId?: string;
} | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null;
  const questions: GeminiQuestion[] = [];
  for (const entry of value.questions) {
    const prompt = isRecord(entry)
      ? (typeof entry.prompt === 'string' ? entry.prompt : typeof entry.question === 'string' ? entry.question : null)
      : null;
    if (!isRecord(entry) || !prompt || !Array.isArray(entry.options)) {
      return null;
    }
    const id = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : prompt;
    const options: GeminiQuestionOption[] = [];
    for (const option of entry.options) {
      if (typeof option === 'string') {
        options.push({ id: option, label: option });
        continue;
      }
      if (!isRecord(option) || typeof option.label !== 'string') return null;
      const optionId = typeof option.id === 'string' && option.id.trim()
        ? option.id.trim()
        : option.label;
      options.push({
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
        id: optionId,
        label: option.label,
      });
    }
    questions.push({
      allowMultiple: entry.allowMultiple === true || entry.multiSelect === true || entry.is_multi_select === true,
      id,
      options,
      prompt,
    });
  }
  return {
    questions,
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
  };
}

function buildAskQuestionAnswers(
  questions: readonly GeminiQuestion[],
  rawAnswers: Record<string, string | string[]>,
): Array<{ questionId: string; selectedOptionIds: string[] }> {
  const answers: Array<{ questionId: string; selectedOptionIds: string[] }> = [];
  for (const question of questions) {
    const values = rawAnswers[question.id] ?? rawAnswers[question.prompt];
    if (values === undefined) continue;
    const normalized = (Array.isArray(values) ? values : [values]).filter(Boolean);
    answers.push({
      questionId: question.id,
      selectedOptionIds: normalized.map(value => (
        question.options.find(option => option.id === value || option.label === value)?.id
        ?? value
      )),
    });
  }
  return answers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
