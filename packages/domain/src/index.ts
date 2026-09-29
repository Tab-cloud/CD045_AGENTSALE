const domainErrorBrand=Symbol.for('agentsale.domain-error');
export class DomainError extends Error{
  readonly [domainErrorBrand]=true;
  constructor(public code:string,message:string,public status=400){super(message);}
  static is(error:unknown):error is DomainError{return error instanceof Error&&(error as unknown as Record<symbol,unknown>)[Symbol.for('agentsale.domain-error')]===true;}
}
