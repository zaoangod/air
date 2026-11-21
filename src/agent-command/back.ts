import inquirer from 'inquirer'
import type {ChatContext} from '../agent-type.js'
import {saveMessageList} from '../config.js'

export async function cmdBack(ctx: ChatContext): Promise<void> {
    const choices = ctx.messageList.flatMap((message, index) => {
        let text: string
        let label: string
        if (message.role === 'user' && typeof message.content === 'string') {
            text = message.content
            label = '👤 用户'
        } else if (message.role === 'tool') {
            text = message.content.flatMap(part => {
                if (part.type !== 'tool-result' || !('value' in part.output)) return []
                const {value} = part.output
                return typeof value === 'string' ? value : JSON.stringify(value)
            }).join('\n')
            label = '🔧 工具'
        } else {
            return []
        }
        return text ? [ {name: `${ label } ${ text.slice(0, 60) }${ text.length > 60 ? '...' : '' }`, value: index} ] : []
    })

    if (choices.length === 0) {
        console.log('\n❌ 还没有消息可以撤回\n')
        return
    }

    console.log('\n📋 选择要撤回到哪条消息：\n')
    const {selectedIndex} = await inquirer.prompt([
        {type: 'select', name: 'selectedIndex', message: '撤回到:', pageSize: 15, choices: [ {name: '↩️  取消操作', value: -1}, ...choices ]}
    ])
    if (selectedIndex === -1) {
        console.log('\n已取消\n')
        return
    }

    const selected = ctx.messageList[selectedIndex]
    const originalText = selected.role === 'user' && typeof selected.content === 'string' ? selected.content : undefined
    let textToSend: string

    if (originalText !== undefined) {
        console.log('\n原内容: ' + originalText.slice(0, 200) + (originalText.length > 200 ? '...' : '') + '\n')
        const {editChoice} = await inquirer.prompt([
            {
                type: 'select',
                name: 'editChoice',
                message: '请选择:',
                choices: [
                    {name: '✏️  修改后重新发送', value: 'edit'},
                    {name: '🔄 直接重新发送', value: 'resend'},
                    {name: '↩️  取消操作', value: 'cancel'}
                ]
            }
        ])
        if (editChoice === 'cancel') {
            console.log('\n已取消\n')
            return
        }

        textToSend = originalText
        if (editChoice === 'edit') {
            const {editedContent} = await inquirer.prompt([
                {type: 'input', name: 'editedContent', message: '修改消息:', default: originalText}
            ])
            textToSend = editedContent.trim()
            if (!textToSend) {
                console.log('\n❌ 消息不能为空\n')
                return
            }
        }
    } else {
        console.log('\n💡 请输入一条新消息继续对话\n')
        const {newMessage} = await inquirer.prompt([
            {type: 'input', name: 'newMessage', message: '新消息:'}
        ])
        textToSend = newMessage.trim()
        if (!textToSend) {
            console.log('\n已取消\n')
            return
        }
    }

    const previous = ctx.messageList
    ctx.messageList = previous.slice(0, originalText !== undefined ? selectedIndex : selectedIndex + 1)
    try {
        await ctx.send(textToSend)
        saveMessageList(ctx.messageList)
    } catch (error) {
        ctx.messageList = previous
        console.error(`\n❌ ${ error instanceof Error ? error.message : String(error) }`)
    }
}
