import inquirer from 'inquirer'
import type {ChatContext} from '../agent-type.js'
import {SYSTEM_PROMPT} from '../agent-constant.js'
import {listSnapshots, loadSnapshot, saveMessageList} from '../config.js'

export async function cmdLoad(ctx: ChatContext): Promise<void> {
    const snapshots = listSnapshots()
    if (snapshots.length === 0) {
        console.log('\n📭 没有可用的快照\n')
        return
    }
    const {selectedName} = await inquirer.prompt([
        {
            type: 'select',
            name: 'selectedName',
            message: '选择要加载的快照:',
            pageSize: 15,
            choices: [
                {name: '\u21a9\ufe0f  取消操作', value: ''},
                ...snapshots.map((s) => ({name: s.date, value: s.name}))
            ]
        }
    ])
    if (!selectedName) {
        console.log('\n已取消\n')
        return
    }
    let loaded = loadSnapshot(selectedName)
    if (loaded.length === 0) {
        loaded = [ {role: 'system', content: SYSTEM_PROMPT} ]
    }
    saveMessageList(loaded)
    const snap = snapshots.find((s) => s.name === selectedName)
    console.log('\n✅ 已加载快照: ' + (snap ? snap.date : selectedName) + '\n')
    ctx.messageList = loaded
}
