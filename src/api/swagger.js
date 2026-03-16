/**
 * OpenAPI 3.0 specification for the AI Plot Digitizer API.
 *
 * @module api/swagger
 */

export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AI Plot Digitizer API',
    version: '0.1.0',
    description: 'Extract numerical data from scientific plot images.',
    license: { name: 'AGPL-3.0' },
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        operationId: 'healthCheck',
        responses: {
          200: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: '0.1.0' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/extract': {
      post: {
        summary: 'Extract data points from a plot image',
        operationId: 'extractData',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['image', 'axes'],
                properties: {
                  image: { type: 'string', description: 'Base64-encoded image (with or without data URI prefix)' },
                  axes: {
                    type: 'object',
                    description: 'Axis calibration configuration',
                    properties: {
                      type: { type: 'string', enum: ['xy'], default: 'xy' },
                      scale: {
                        type: 'object',
                        properties: {
                          x: { type: 'string', enum: ['linear', 'log', 'ln'], default: 'linear' },
                          y: { type: 'string', enum: ['linear', 'log', 'ln'], default: 'linear' },
                        },
                      },
                      points: {
                        type: 'array',
                        minItems: 4,
                        maxItems: 4,
                        items: {
                          type: 'object',
                          properties: {
                            pixel: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                            value: { type: 'array', items: { type: ['number', 'null'] }, minItems: 2, maxItems: 2 },
                          },
                        },
                      },
                    },
                  },
                  options: {
                    type: 'object',
                    properties: {
                      color: { type: 'string', default: '#000000', description: 'Target colour hex' },
                      tolerance: { type: 'number', default: 30 },
                      method: { type: 'string', enum: ['blob', 'averaging'], default: 'averaging' },
                      dx: { type: 'number', default: 10 },
                      dy: { type: 'number', default: 10 },
                      minDiameter: { type: 'number', default: 0 },
                      maxDiameter: { type: 'number', default: 5000 },
                    },
                  },
                },
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  image: { type: 'string', format: 'binary' },
                  axes: { type: 'string', description: 'JSON string of axis config' },
                  options: { type: 'string', description: 'JSON string of extraction options' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Extracted data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        points: { type: 'number' },
                        method: { type: 'string' },
                        color: { type: 'string' },
                        tolerance: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Bad request' },
          500: { description: 'Server error' },
        },
      },
    },
    '/api/colors': {
      post: {
        summary: 'Analyse dominant colours in an image',
        operationId: 'analyzeColors',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['image'],
                properties: {
                  image: { type: 'string', description: 'Base64-encoded image' },
                  top: { type: 'number', default: 10 },
                  tolerance: { type: 'number', default: 120 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Colour analysis',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    colors: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          r: { type: 'number' },
                          g: { type: 'number' },
                          b: { type: 'number' },
                          hex: { type: 'string' },
                          pixels: { type: 'number' },
                          percentage: { type: 'number' },
                        },
                      },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        width: { type: 'number' },
                        height: { type: 'number' },
                        totalPixels: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/detect-axes': {
      post: {
        summary: 'Auto-detect axes from a plot image (Phase 4)',
        operationId: 'detectAxes',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['image'],
                properties: {
                  image: { type: 'string', description: 'Base64-encoded image' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Detected axes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    axes: { type: 'object', nullable: true },
                    confidence: { type: 'number' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
