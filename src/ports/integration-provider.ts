export type IntegrationOperationInput<TPayload> = {
  provider: string;
  operation: string;
  eventId: string;
  payload: TPayload;
  workItemId?: string | undefined;
  resourceId?: string | undefined;
  idempotencyKey?: string | undefined;
  requestHash?: string | undefined;
};

export type IntegrationOperationResult<TResult> = {
  externalId?: string | undefined;
  result: TResult;
};

export type IntegrationProviderError = {
  code: string;
  message: string;
};

export interface IntegrationProvider<TPayload, TResult> {
  execute(input: TPayload): Promise<IntegrationOperationResult<TResult>>;
}
