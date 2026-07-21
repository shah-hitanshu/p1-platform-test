/**
 * useAuth Hook
 *
 * Hook to access auth context.
 */

import { useContext } from 'react';
import { AuthContext } from '../context/AuthContextType';

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
