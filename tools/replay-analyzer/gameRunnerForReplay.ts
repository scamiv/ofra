import { ensureEnvFetchShim } from "./envShim";
import { FileSystemGameMapLoader } from "./FileSystemGameMapLoader";
import type { OpenFrontRuntime } from "./openfrontLoader";
import type { CapturedState } from "./stateCapture";

export async function createGameRunnerForReplay(
  openfront: OpenFrontRuntime,
  gameStart: any,
  clientID: string,
  gameUpdate: (gu: any) => void,
  mapsRoot: string,
  capturedState?: CapturedState,
): Promise<any> {
  ensureEnvFetchShim();
  const mapLoader = new FileSystemGameMapLoader(mapsRoot, openfront.Game.GameMapType);

  // If we have captured state, we need to inject it into the game creation
  // This is tricky because we can't modify the OpenFront source.
  // For now, we'll modify the gameStart object to use captured player IDs

  if (capturedState && capturedState.playerIdSequence.length > 0) {
    // We'll use a global approach: set up the injection before calling createGameRunner
    let idIndex = 0;
    const originalRandom = Math.random;
    Math.random = () => {
      // This is a hack - we're overriding Math.random to force specific ID generation
      // This won't work perfectly but it's the best we can do without modifying OpenFront
      if (idIndex < capturedState.playerIdSequence.length) {
        // Convert the captured ID back to a pseudo-random number that would generate it
        // This is approximate and may not work perfectly
        const capturedId = capturedState.playerIdSequence[idIndex++];
        // Extract the numeric part and convert back to a random-like value
        const numericId = parseInt(capturedId, 36);
        return (numericId % 1000000) / 1000000; // Rough approximation
      }
      return originalRandom();
    };

    try {
      const result = await openfront.GameRunner.createGameRunner(gameStart, clientID, mapLoader, gameUpdate);
      return result;
    } finally {
      // Restore original Math.random
      Math.random = originalRandom;
    }
  }

  return await openfront.GameRunner.createGameRunner(gameStart, clientID, mapLoader, gameUpdate);
}
