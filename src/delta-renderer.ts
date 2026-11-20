import type {TextStreamPart, ToolSet} from 'ai'
import chalk from 'chalk'

export class DeltaRenderer {
    private reasoningPrint = false
    private contentPrint = false
    private toolPrint = 0

    render(part: TextStreamPart<ToolSet>): void {
        switch (part.type) {
            case 'start-step':
                this.reasoningPrint = false
                this.contentPrint = false
                this.toolPrint = 0
                break
            case 'reasoning-delta':
                if (!this.reasoningPrint) {
                    process.stdout.write('\n\n💭 思考中...\n')
                    this.reasoningPrint = true
                }
                process.stdout.write(chalk.blue(part.text))
                break
            case 'text-delta':
                if (!this.contentPrint) {
                    process.stdout.write('\n\n💭 回答中...\n')
                    this.contentPrint = true
                }
                process.stdout.write(chalk.white(part.text))
                break
            case 'tool-call':
                if (this.toolPrint === 0) {
                    process.stdout.write(chalk.blue.bold('\n\n💭 工具调用中...'))
                }
                this.toolPrint++
                process.stdout.write(chalk.magenta.bold(`\n🔧 ${ this.toolPrint } ${ part.toolName }\n`))
                process.stdout.write(chalk.gray(`${ JSON.stringify(part.input, null, 4) }\n`))
                break
        }
    }
}
