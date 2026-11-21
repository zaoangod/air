#!/usr/bin/env node
import {Command} from 'commander'
import {runChat} from './agent-runtime.js'
import {readConfig, saveConfig} from './config.js'
import {installHook, uninstallHook} from './hook.js'
import packageJson from '../package.json' with {type: 'json'}

const program = new Command()

program
    .name(packageJson.name)
    .version(packageJson.version)
    .description(packageJson.description)

program
    .command('key')
    .description('设置 API Key')
    .argument('<apiKey>', 'DeepSeek API Key')
    .action((apiKey: string) => {
        saveConfig(apiKey)
        console.log('✅ API Key 已设置')
    })

program
    .command('config')
    .description('查看当前配置')
    .action(() => {
        const c = readConfig()
        const key = c.apiKey ? '****' + c.apiKey.slice(-4) : '(未设置)'
        console.log(`API Key: ${ key }`)
    })

program
    .command('hook')
    .description('安装/卸载兜底终端钩子（命令不存在时自动转发到 air）')
    .argument('<action>', 'install 或 uninstall')
    .action((action: string) => {
        if (action === 'install') {
            installHook()
        } else if (action === 'uninstall') {
            uninstallHook()
        } else {
            console.error('❌ 未知操作，请使用 install 或 uninstall')
        }
    })

program
    .argument('[message...]', '要发送的消息（不传则进入交互模式）')
    .action(async (message?: string[]) => {
        const config = readConfig()
        if (!config.apiKey) {
            console.error('❌ 请先设置 API Key: air key <your-key>')
            console.error('   获取 Key: https://platform.deepseek.com/api_keys')
            process.exit(1)
        }
        await runChat(message?.join(' '))
    })

program.parse(process.argv)

async function main() {

}
