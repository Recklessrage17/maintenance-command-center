import { createContext, useContext, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

export const LibraryHeaderBackContext = createContext<Dispatch<SetStateAction<(() => void) | null>> | null>(null);

export function useLibraryHeaderBack(active: boolean, onBack: () => void) {
  const setBack = useContext(LibraryHeaderBackContext);
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    if (!setBack || !active) return;
    setBack(() => () => backRef.current());
    return () => setBack(null);
  }, [active, setBack]);
}
