import type { Request, Response, NextFunction } from 'express'
import { Boom } from '@hapi/boom'

/**
 * Express error handler that maps Boom errors to proper HTTP responses
 * and wraps unexpected errors in a 500.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
	if (err instanceof Boom) {
		res.status(err.output.statusCode).json({
			error: err.output.payload.error,
			message: err.message
		})
		return
	}

	// Unknown error — don't leak internals
	res.status(500).json({
		error: 'Internal Server Error',
		message: 'An unexpected error occurred.'
	})
}
