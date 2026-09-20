/**
 * Erros de domínio padronizados para a API.
 * Nunca vazar stack trace para o cliente em produção.
 */

export class AppError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function errorResponse(err) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }

  // Erro inesperado: NÃO logamos aqui de novo — o handler do Fastify já
  // registra com o contexto da requisição (log.error). Duplicar poluía o log
  // com stack traces de erros já reportados.
  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor.',
      },
    },
  };
}
