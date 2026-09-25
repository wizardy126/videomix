import { useCallback, useState } from 'react';

const remote = window.require('@electron/remote');
const { configStore } = remote.require('./index.js');

const CONFIG_KEY = 'fitMagnet';

function readFitMagnet() {
  try {
    return configStore.get(CONFIG_KEY) === true;
  } catch (err) {
    console.error('Failed to read the magnet setting', err);
    return false;
  }
}

/**
 * F2 (T45): the rect editor's magnet toggle, off by default. It's an app preference (stored in the app config by
 * main, `fitMagnet`), not part of the project, so it isn't undoable.
 */
export default function useFitMagnet() {
  const [magnet, setMagnet] = useState(readFitMagnet);

  const toggleMagnet = useCallback(() => {
    const value = !magnet;
    setMagnet(value);
    try {
      configStore.set(CONFIG_KEY, value);
    } catch (err) {
      console.error('Failed to save the magnet setting', err);
    }
  }, [magnet]);

  return { magnet, toggleMagnet };
}
