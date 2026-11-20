import {describe, expect, it} from 'vitest'
import {asSchema} from 'ai'
import {tools} from '../tools.js'

describe('shell tool', () => {
    it('具有正确的名称和描述', () => {
        expect(Object.keys(tools)).toEqual([ 'shell' ])
        expect(tools.shell.description).toBe('执行 shell 命令并返回输出')
    })

    it('参数定义正确', async () => {
        const schema = await asSchema(tools.shell.inputSchema).jsonSchema
        expect(schema.properties?.command).toMatchObject({type: 'string'})
        expect(schema.required).toEqual([ 'command' ])
    })
})
