import askQuestionFixture from '@test/fixtures/providers/cursor/extensions/ask-question.json';
import createPlanFixture from '@test/fixtures/providers/cursor/extensions/create-plan.json';
import updateTodosFixture from '@test/fixtures/providers/cursor/extensions/update-todos.json';
import taskFixture from '@test/fixtures/providers/cursor/extensions/task.json';
import generateImageFixture from '@test/fixtures/providers/cursor/extensions/generate-image.json';

import type { ProviderInteractionPort, ProviderQuestionInteractionRequest } from '@/core/execution';
import { CursorExecutionInteractionRouter } from '@/providers/cursor/execution/CursorExecutionInteractionRouter';

function createPort(
  resolveAnswers: (
    request: ProviderQuestionInteractionRequest,
  ) => Record<string, string | string[]> | null,
): ProviderInteractionPort {
  return {
    askUserQuestion: jest.fn(async (request) => ({
      answers: resolveAnswers(request),
      interactionId: request.interactionId,
    })),
    dismissInteraction: jest.fn(),
    requestApproval: jest.fn(async (request) => ({
      decision: 'allow' as const,
      interactionId: request.interactionId,
    })),
  };
}

describe('CursorExecutionInteractionRouter', () => {
  it('answers cursor/ask_question through the ask-user UI', async () => {
    const port = createPort(() => ({ q1: 'agent' }));
    const router = new CursorExecutionInteractionRouter(
      port,
      'session-instance',
      () => 'turn-1',
      () => 'ses_1',
    );

    const response = await router.handle('cursor/ask_question', askQuestionFixture);

    expect(port.askUserQuestion).toHaveBeenCalled();
    expect(response).toMatchObject({
      outcome: 'answered',
      answers: expect.any(Array),
    });
  });

  it('accepts or rejects cursor/create_plan through a question prompt', async () => {
    const port = createPort(() => ({ 'cursor-create-plan': 'accept' }));
    const router = new CursorExecutionInteractionRouter(
      port,
      'session-instance',
      () => 'turn-1',
      () => 'ses_1',
    );

    await expect(router.handle('cursor/create_plan', createPlanFixture)).resolves.toEqual({
      outcome: 'accepted',
    });
  });

  it('presents cursor/update_todos without throwing', async () => {
    const port = createPort(() => ({ 'cursor-update-todos': 'dismiss' }));
    const router = new CursorExecutionInteractionRouter(
      port,
      'session-instance',
      () => 'turn-1',
      () => 'ses_1',
    );

    await expect(router.handle('cursor/update_todos', updateTodosFixture)).resolves.toBeUndefined();
    expect(port.askUserQuestion).toHaveBeenCalled();
  });

  it('handles cursor/task and cursor/generate_image notifications', async () => {
    const port = createPort(() => null);
    const router = new CursorExecutionInteractionRouter(
      port,
      'session-instance',
      () => 'turn-1',
      () => 'ses_1',
    );

    await expect(router.handle('cursor/task', taskFixture)).resolves.toBeUndefined();
    await expect(router.handle('cursor/generate_image', generateImageFixture)).resolves.toBeUndefined();
  });
});
