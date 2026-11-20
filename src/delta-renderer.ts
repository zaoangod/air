import type {TextStreamPart, ToolSet} from 'ai'
import chalk from 'chalk'

export class DeltaRenderer {
    private reasoningPrinted = false
    private contentPrinted = false
    private toolsPrinted = 0

    render(part: TextStreamPart<ToolSet>): void {
        switch (part.type) {
            case 'start-step':
                this.reasoningPrinted = false
                this.contentPrinted = false
                this.toolsPrinted = 0
                break
            case 'reasoning-delta':
                if (!this.reasoningPrinted) {
                    process.stdout.write('\n\n💭 思考中...\n')
                    this.reasoningPrinted = true
                }
                process.stdout.write(chalk.blue(part.text))
                break
            case 'text-delta':
                if (!this.contentPrinted) {
                    process.stdout.write('\n\n💭 回答中...\n')
                    this.contentPrinted = true
                }
                process.stdout.write(chalk.white(part.text))
                break
            case 'tool-call':
                if (this.toolsPrinted === 0) process.stdout.write(chalk.blue.bold('\n\n💭 工具调用中...'))
                this.toolsPrinted++
                process.stdout.write(chalk.magenta.bold(`\n🔧 ${ this.toolsPrinted } ${ part.toolName }\n`))
                process.stdout.write(chalk.gray(`${ JSON.stringify(part.input, null, 4) }\n`))
                break
        }
    }
}
