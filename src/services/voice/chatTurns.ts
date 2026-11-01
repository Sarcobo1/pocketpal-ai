import {chatSessionStore} from '../../store';

/** The turn row `turnId` wrote, wherever the session store holds it now. */
export const findTurn = (turnId: string) => {
  for (const session of chatSessionStore.sessions) {
    const message = session.messages.find(m => m.id === turnId);
    if (message) {
      return {sessionId: session.id, message};
    }
  }
  return null;
};
