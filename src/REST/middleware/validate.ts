import type { Request, Response, NextFunction } from 'express'
import type { ZodType } from 'zod'

/**
 * Creates an Express middleware that validates `req.body` against a Zod schema.
 * On failure, returns a 400 with structured validation errors.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * router.post('/send', validate(z.object({ jid: z.string(), text: z.string() })), handler)
 * ```
 */
export function validate<T>(schema: ZodType<T>) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const result = schema.safeParse(req.body)
		if (!result.success) {
			res.status(400).json({
				error: 'Validation Error',
				message: 'Request body validation failed.',
				details: result.error.errors.map(e => ({
					field: e.path.join('.'),
					message: e.message
				}))
			})
			return
		}

		req.body = result.data
		next()
	}
}
