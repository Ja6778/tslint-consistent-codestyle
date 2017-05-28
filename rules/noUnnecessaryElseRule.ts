import * as ts from 'typescript';
import * as Lint from 'tslint';
import * as utils from 'tsutils';
import { AbstractIfStatementWalker } from '../src/walker';
import { isElseIf } from '../src/utils';

const FAIL_MESSAGE = `unnecessary else`;

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithWalker(new IfWalker(sourceFile, this.ruleName, undefined));
    }
}

class IfWalker extends AbstractIfStatementWalker<void> {
    protected _checkIfStatement(node: ts.IfStatement) {
        if (node.elseStatement !== undefined &&
            !isElseIf(node) &&
            utils.endsControlFlow(node.thenStatement))
            this.addFailureAtNode(node.getChildAt(5 /*else*/, this.sourceFile)!, FAIL_MESSAGE);
    }
}
