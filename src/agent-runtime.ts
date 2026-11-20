import {streamText} from 'ai'
import chalk from 'chalk'
import inquirer from 'inquirer'
import {DeltaRenderer} from './delta-renderer.js'
import {readConfig, readMessages, saveMessages, saveSnapshot} from './config.js'
import {createModel} from './model.js'
import {tools} from './tools.js'
import {contextSize, generateMigrationDoc, MAX_CONTEXT_CHARS, shouldMigrate} from './migration.js'
import {dispatchCommand} from './agent-commands/index.js'
import type {ChatCtx} from './agent-types.js'
import {SYSTEM_PROMPT} from './agent-constants.js'

// ==================== print (内部使用) ====================

async function send(ctx: ChatCtx, model: ReturnType<typeof createModel>, text: string): Promise<void> {
    console.log(chalk.green.bold('\n🤖 AI:'))
    const renderer = new DeltaRenderer()
    const userMessage = {role: 'user', content: text} as const
    const result = streamText({
        model,
        messages: [ ...ctx.messages, userMessage ],
        allowSystemInMessages: true,
        tools,
        // Continue after tool results until the model finishes the turn.
        stopWhen: [],
        onError: () => {
        } // The CLI reports errors from the stream below.
    })

    for await (const part of result.stream) {
        if (part.type === 'error') throw part.error
        if (part.type === 'abort') throw new Error('模型请求已中止')
        renderer.render(part)
    }

    ctx.messages.push(userMessage, ...await result.responseMessages)
    process.stdout.write('\n\n')
    console.log()
}

// ==================== message ====================

async function handleMessage(ctx: ChatCtx, text: string): Promise<void> {
    try {
        await ctx.send(text)
        saveMessages(ctx.messages)

        if (shouldMigrate(ctx.messages)) {
            console.log(`🔄 上下文 ${ contextSize(ctx.messages) }/${ MAX_CONTEXT_CHARS }，准备迁移...`)
            try {
                const snap = saveSnapshot(ctx.messages)
                console.log(`  💾 快照: ${ snap }`)
                const summary = await generateMigrationDoc(ctx.messages)
                const messages: ChatCtx['messages'] = [
                    {role: 'system', content: SYSTEM_PROMPT},
                    {role: 'user', content: summary}
                ]
                saveMessages(messages)
                ctx.messages = messages
                console.log('✅ 迁移完成\n')
            } catch (error) {
                console.error(`❌ 迁移失败: ${ error instanceof Error ? error.message : String(error) }\n`)
            }
        }
    } catch (error) {
        console.error(`\n❌ ${ error instanceof Error ? error.message : String(error) }`)
    }
}

// ==================== runtime ====================

async function chatLoop(ctx: ChatCtx) {
    while (true) {
        const {input} = await inquirer.prompt([
            {type: 'input', name: 'input', message: '你:'}
        ])
        const t = input.trim()
        if (!t) continue
        if (t.startsWith('/')) {
            await dispatchCommand(ctx, t.toLowerCase())
            continue
        }
        await handleMessage(ctx, t)
    }
}

export async function runChat(initialMessage?: string): Promise<void> {
    const config = readConfig()
    if (!config.apiKey) {
        console.error('❌ 请先设置 API Key: air key <your-key>')
        console.error('   获取 Key: https://platform.deepseek.com/api_keys')
        process.exit(1)
    }

    let msgs = readMessages()
    if (msgs.length === 0) {
        msgs = [ {role: 'system', content: SYSTEM_PROMPT} ]
        saveMessages(msgs)
    }
    const model = createModel(config.apiKey)
    const ctx: ChatCtx = {
        messages: msgs,
        send(text: string) {
            return send(this, model, text)
        }
    }

    if (initialMessage) {
        const hasHistory = ctx.messages.some(m => m.role === 'user' || m.role === 'assistant')
        if (hasHistory) {
            const snap = saveSnapshot(ctx.messages)
            console.log(`💾 已存档旧对话: ${ snap }\n`)
        }
        await dispatchCommand(ctx, '/new')
        console.log(`💬 你: ${ initialMessage }`)
        await handleMessage(ctx, initialMessage)
        console.log('\n💬 继续对话 (输入 /exit 退出)\n')
        await chatLoop(ctx)
        return
    }

    const msgCount = ctx.messages.filter((m) => m.role !== 'system').length
    console.log(msgCount > 0
        ? `\n💬 继续上次对话 (${ msgCount } 条，/${ contextSize(ctx.messages) } 字符，输入 /new 重新开始)\n`
        : '\n💬 air — 极简 AI 助手 (输入 /help 查看命令)\n')

    await chatLoop(ctx)
}
