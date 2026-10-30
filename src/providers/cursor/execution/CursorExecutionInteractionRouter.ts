import {
  type PendingInteraction,
  PendingInteractionLedger,
  type ProviderInteractionDismissReason,
  type ProviderInteractionPort,
} from '../../../core/execution';

interface CursorQuestionOption {
  readonly description?: string;
  readonly id: string;
  readonly label: string;
}

interface CursorQuestion {
  readonly allowMultiple: boolean;
  readonly id: string;
  readonly options: readonly CursorQuestionOption[];
  readonly prompt: string;
}

/**
 * Routes Cursor ACP extension requests/notifications through feature interaction ports.
 * Notifications (`update_todos`, `task`, `generate_image`) are acknowledged without a
 * dedicated todo/subagent port beyond askUserQuestion presentation when useful.
 */
export class CursorExecutionInteractionRouter {
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
      case 'cursor/ask_question':
        return this.#handleAskQuestion(params, signal);
      case 'cursor/create_plan':
        return this.#handleCreatePlan(params, signal);
      case 'cursor/update_todos':
        return this.#handleUpdateTodos(params, signal);
      case 'cursor/task':
        return this.#handleTask(params, signal);
      case 'cursor/generate_image':
        return this.#handleGenerateImage(params, signal);
      default:
        throw new Error(`Unsupported Cursor server request: ${method}`);
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

  async #handleCreatePlan(params: unknown, signal?: AbortSignal): Promise<unknown> {
    const turnId = this.getTurnId();
    const plan = parseCreatePlanRequest(params);
    if (!turnId || !plan || signal?.aborted) {
      return { outcome: 'cancelled' };
    }
    const pending = this.#begin(this.#nextId('plan'));
    let dismissReason: ProviderInteractionDismissReason = 'cancelled';
    try {
      const overview = [
        plan.name,
        plan.overview,
        plan.plan,
      ].filter(Boolean).join('\n\n');
      const response = await this.interactionPort.askUserQuestion({
        input: {
          questions: [{
            header: 'Plan',
            id: 'cursor-create-plan',
            multiSelect: false,
            options: [
              { description: 'Accept this plan and continue.', label: 'Accept', value: 'accept' },
              { description: 'Reject this plan.', label: 'Reject', value: 'reject' },
            ],
            question: overview || 'Accept this Cursor plan?',
          }],
        },
        interactionId: pending.interactionId,
        kind: 'question',
        nativeContext: {
          sessionId: this.getSessionId(),
          toolCallId: plan.toolCallId,
        },
        sessionInstanceId: this.sessionInstanceId,
        turnId,
      }, pending.signal);
      if (this.pending.isStaleResponse(pending, response) || this.getTurnId() !== turnId) {
        dismissReason = 'native-rejected';
        return { outcome: 'cancelled' };
      }
      const answer = response.answers?.['cursor-create-plan'];
      const value = Array.isArray(answer) ? answer[0] : answer;
      if (value === 'accept') {
        dismissReason = 'resolved';
        return { outcome: 'accepted' };
      }
      if (value === 'reject') {
        dismissReason = 'resolved';
        return { outcome: 'rejected' };
      }
      return { outcome: 'cancelled' };
    } catch {
      return { outcome: 'cancelled' };
    } finally {
      this.pending.settle(pending, dismissReason);
    }
  }

  async #handleUpdateTodos(params: unknown, signal?: AbortSignal): Promise<void> {
    const turnId = this.getTurnId();
    const request = parseUpdateTodosRequest(params);
    if (!turnId || !request || signal?.aborted) return;
    const pending = this.#begin(this.#nextId('todos'));
    try {
      await this.interactionPort.askUserQuestion({
        input: {
          questions: [{
            header: 'Todos',
            id: 'cursor-update-todos',
            multiSelect: false,
            options: [{ label: 'Dismiss', value: 'dismiss' }],
            question: formatTodos(request.todos),
          }],
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
      this.pending.settle(pending, 'resolved');
    } catch {
      this.pending.settle(pending, 'cancelled');
    }
  }

  async #handleTask(params: unknown, signal?: AbortSignal): Promise<void> {
    const turnId = this.getTurnId();
    const request = parseTaskRequest(params);
    if (!turnId || !request || signal?.aborted) return;
    const pending = this.#begin(this.#nextId('task'));
    try {
      await this.interactionPort.askUserQuestion({
        input: {
          questions: [{
            header: request.subagentType || 'Task',
            id: 'cursor-task',
            multiSelect: false,
            options: [{ label: 'Dismiss', value: 'dismiss' }],
            question: [request.description, request.prompt].filter(Boolean).join('\n\n'),
          }],
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
      this.pending.settle(pending, 'resolved');
    } catch {
      this.pending.settle(pending, 'cancelled');
    }
  }

  async #handleGenerateImage(params: unknown, signal?: AbortSignal): Promise<void> {
    const turnId = this.getTurnId();
    const request = parseGenerateImageRequest(params);
    if (!turnId || !request || signal?.aborted) return;
    const pending = this.#begin(this.#nextId('image'));
    try {
      await this.interactionPort.askUserQuestion({
        input: {
          questions: [{
            header: 'Generated image',
            id: 'cursor-generate-image',
            multiSelect: false,
            options: [{ label: 'Dismiss', value: 'dismiss' }],
            question: [
              request.description,
              request.filePath ? `Path: ${request.filePath}` : '',
            ].filter(Boolean).join('\n'),
          }],
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
      this.pending.settle(pending, 'resolved');
    } catch {
      this.pending.settle(pending, 'cancelled');
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
  questions: CursorQuestion[];
  toolCallId?: string;
} | null {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null;
  const questions: CursorQuestion[] = [];
  for (const entry of value.questions) {
    if (!isRecord(entry) || typeof entry.prompt !== 'string' || !Array.isArray(entry.options)) {
      return null;
    }
    const id = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : entry.prompt;
    const options: CursorQuestionOption[] = [];
    for (const option of entry.options) {
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
      allowMultiple: entry.allowMultiple === true || entry.multiSelect === true,
      id,
      options,
      prompt: entry.prompt,
    });
  }
  return {
    questions,
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
  };
}

function buildAskQuestionAnswers(
  questions: readonly CursorQuestion[],
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

function parseCreatePlanRequest(value: unknown): {
  name?: string;
  overview?: string;
  plan?: string;
  toolCallId?: string;
} | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.overview === 'string' ? { overview: value.overview } : {}),
    ...(typeof value.plan === 'string' ? { plan: value.plan } : {}),
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
  };
}

function parseUpdateTodosRequest(value: unknown): {
  todos: Array<{ content: string; id: string; status: string }>;
  toolCallId?: string;
} | null {
  if (!isRecord(value) || !Array.isArray(value.todos)) return null;
  const todos: Array<{ content: string; id: string; status: string }> = [];
  for (const entry of value.todos) {
    if (!isRecord(entry) || typeof entry.content !== 'string') continue;
    todos.push({
      content: entry.content,
      id: typeof entry.id === 'string' ? entry.id : String(todos.length + 1),
      status: typeof entry.status === 'string' ? entry.status : 'pending',
    });
  }
  return {
    todos,
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
  };
}

function formatTodos(
  todos: ReadonlyArray<{ content: string; id: string; status: string }>,
): string {
  if (todos.length === 0) return 'Todo list updated.';
  return todos.map(todo => `- [${todo.status}] ${todo.content}`).join('\n');
}

function parseTaskRequest(value: unknown): {
  description?: string;
  prompt?: string;
  subagentType?: string;
  toolCallId?: string;
} | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.subagentType === 'string' ? { subagentType: value.subagentType } : {}),
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
  };
}

function parseGenerateImageRequest(value: unknown): {
  description?: string;
  filePath?: string;
  toolCallId?: string;
} | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.filePath === 'string' ? { filePath: value.filePath } : {}),
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
