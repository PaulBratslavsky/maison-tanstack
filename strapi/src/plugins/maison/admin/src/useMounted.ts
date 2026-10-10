import * as React from 'react';

/**
 * Whether the component is still on screen. It is a ref, so a request that outlives the component (the tab was switched
 * while it was in flight) can check before it sets state or opens a dialog, which would update a component that is gone.
 */
export const useMounted = (): React.MutableRefObject<boolean> => {
  const mounted = React.useRef(true);

  React.useEffect(() => {
    // Set again on every mount, so a component React mounts, unmounts and mounts again (Strict Mode, in development) counts as mounted.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return mounted;
};
