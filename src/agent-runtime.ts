import chalk from 'chalk'
import {streamText} from 'ai'
import inquirer from 'inquirer'
import {tools} from './tool/tools.js'
import {createModel} from './model.js'
import type {ChatContext} from './agent-type.js'
import {SYSTEM_PROMPT} from './agent-constant.js'
import {DeltaRenderer} from './delta-renderer.js'
import {dispatchCommand} from './agent-command/index.js'
import {readConfig, readMessages, saveMessages, saveSnapshot} from './config.js'
import {contextSize, generateMigrationDoc, MAX_CONTEXT_CHARS, shouldMigrate} from './migration.js'

// ==================== print (内部使用) ====================

async function send(ctx: ChatContext, model: ReturnType<typeof createModel>, text: string): Promise<void> {
    console.log(chalk.green.bold('🤖AI:'))
    const renderer = new DeltaRenderer()
    const userMessage = {role: 'user', content: text} as const
    const result = streamText({
        model,
        messages: [ ...ctx.messageList, userMessage ],
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

    ctx.messageList.push(userMessage, ...await result.responseMessages)
    process.stdout.write('\n')
}

// ==================== message ====================

async function handleMessage(ctx: ChatContext, text: string): Promise<void> {
    try {
        await ctx.send(text)
        saveMessages(ctx.messageList)

        if (shouldMigrate(ctx.messageList)) {
            console.log(`🔄 上下文 ${ contextSize(ctx.messageList) }/${ MAX_CONTEXT_CHARS }，准备迁移...`)
            try {
                const snap = saveSnapshot(ctx.messageList)
                console.log(`  💾 快照: ${ snap }`)
                const summary = await generateMigrationDoc(ctx.messageList)
                const messages: ChatContext['messageList'] = [
                    {role: 'system', content: SYSTEM_PROMPT},
                    {role: 'user', content: summary}
                ]
                saveMessages(messages)
                ctx.messageList = messages
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

async function chatLoop(ctx: ChatContext) {
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
    const ctx: ChatContext = {
        messageList: msgs,
        send(text: string) {
            return send(this, model, text)
        }
    }

    if (initialMessage) {
        const hasHistory = ctx.messageList.some(m => m.role === 'user' || m.role === 'assistant')
        if (hasHistory) {
            const snap = saveSnapshot(ctx.messageList)
            console.log(`💾 已存档旧对话: ${ snap }\n`)
        }
        await dispatchCommand(ctx, '/new')
        console.log(`💬 你: ${ initialMessage }`)
        await handleMessage(ctx, initialMessage)
        console.log('\n💬 继续对话 (输入 /exit 退出)\n')
        await chatLoop(ctx)
        return
    }

    const msgCount = ctx.messageList.filter((m) => m.role !== 'system').length
    console.log(msgCount > 0
        ? `\n💬 继续上次对话 (${ msgCount } 条，/${ contextSize(ctx.messageList) } 字符，输入 /new 重新开始)\n`
        : '\n💬 air — 极简 AI 助手 (输入 /help 查看命令)\n')

    await chatLoop(ctx)
}
