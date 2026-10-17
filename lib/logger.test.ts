import { describe, expect, it } from 'vitest'
import { logger, loggerDestination, loggerOptions } from './logger'

describe('loggerOptions', () => {
  it('is silent in tests', () => {
    expect(loggerOptions('test')).toEqual({ level: 'silent' })
  })

  it('logs structured JSON at info level in production', () => {
    expect(loggerOptions('production')).toEqual({ level: 'info' })
  })

  it('logs at debug level everywhere else', () => {
    expect(loggerOptions('development')).toEqual({ level: 'debug' })
  })
})

describe('loggerDestination', () => {
  it('has no pretty-printing stream in tests', () => {
    expect(loggerDestination('test')).toBeUndefined()
  })

  it('has no pretty-printing stream in production', () => {
    expect(loggerDestination('production')).toBeUndefined()
  })

  it('pretty-prints to a plain in-thread stream everywhere else', () => {
    const stream = loggerDestination('development')
    expect(stream).toBeDefined()
    expect(typeof stream?.write).toBe('function')
  })
})

describe('logger', () => {
  it('is a pino instance silenced for the test environment', () => {
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(logger.level).toBe('silent')
  })
})
