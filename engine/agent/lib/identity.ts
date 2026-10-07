type ContextIdentity = { session:{ id:string; auth:{ current?:{ principalId?:string } | null; initiator?:{ principalId?:string } | null } } };
export function ownerKeyFromContext(ctx: ContextIdentity):string { return ctx.session.auth.current?.principalId || ctx.session.auth.initiator?.principalId || `session:${ctx.session.id}`; }
