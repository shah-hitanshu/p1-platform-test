/**
 * API Response Component
 *
 * Displays API response with loading, error, and success states.
 */

import { Alert } from '@pantheon-systems/design-toolkit-react';
import { JsonViewer } from './JsonViewer';
import './ApiResponse.css';

interface ApiResponseProps {
  data: unknown;
  isLoading: boolean;
  error: string | null;
  title?: string;
}

export function ApiResponse({ data, isLoading, error, title }: ApiResponseProps) {
  if (isLoading) {
    return (
      <div className="api-response api-response-loading">
        <div className="loading-spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="api-response">
        <Alert type="danger">{error}</Alert>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="api-response api-response-empty">
        <span>No data to display</span>
      </div>
    );
  }

  return (
    <div className="api-response api-response-success">
      <JsonViewer data={data} title={title} />
    </div>
  );
}
