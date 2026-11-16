import React from 'react';
import { exportScoringRecovery } from '../services/storageService';

/** Recovery never offers to clear, replace, or force-upload a saved score copy. */
export const ScoringRecovery = ({ matchId }: { matchId: string }) => {
  const download = () => {
    try {
      const blob = new Blob([exportScoringRecovery(matchId)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `dugout-saved-scores-${matchId}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert('The saved copy cannot be opened right now. Keep this page open and ask the person running the league for help. Do not clear browser data.');
    }
  };
  return <div className="space-y-2 text-sm">
    <button type="button" onClick={download} className="rounded-lg border px-3 py-2 font-semibold">Download saved scores</button>
    <p>Your recovery copy stays on this device. If retry does not finish, give this download to the person running the league to compare with the game. Do not re-enter pitches or clear browser data.</p>
  </div>;
};
