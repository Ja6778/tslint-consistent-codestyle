import * as ts from 'typescript';
import * as Lint from 'tslint';
import * as utils from 'tsutils';

import { AbstractConfigDependentRule } from '../src/rules';

// TODO don't flag inherited members
// TODO check renamed imports
// TODO skip all ambient declarations
// TODO async modifier
// TODO public protected private as modifier on class or just final for private

const PASCAL_OPTION = 'PascalCase';
const CAMEL_OPTION  = 'camelCase';
const SNAKE_OPTION  = 'snake_case';
const UPPER_OPTION  = 'UPPER_CASE';

const FORMAT_FAIL   = ' name must be in ';
const LEADING_FAIL  = ' name must not have leading underscore';
const TRAILING_FAIL = ' name must not have trailing underscore';
const NO_LEADING_FAIL  = ' name must have leading underscore';
const NO_TRAILING_FAIL = ' name must have trailing underscore';
const REGEX_FAIL    = ' name did not match required regex';
const PREFIX_FAIL   = ' name must start with ';
const SUFFIX_FAIL   = ' name must end with ';
const PREFIX_FAIL_ARR  = ' name must start with one of ';
const SUFFIX_FAIL_ARR  = ' name must end with one of ';

type DeclarationWithIdentifierName = ts.Declaration & {name: ts.Identifier};

enum Types {
    // tslint:disable:naming-convention
    default = -1,
    variable = 1,
    function = 1 << 1,
    parameter = 1 << 2,
    member = 1 << 3,
    property = 1 << 4,
    method = 1 << 5,
    type = 1 << 6,
    class = 1 << 7,
    interface = 1 << 8,
    typeAlias = 1 << 9,
    genericTypeParameter = 1 << 10,
    enum = 1 << 11,
    enumMember = 1 << 12,
    // tslint:enable:naming-convention
}

enum TypeSelector {
    // tslint:disable:naming-convention
    variable = Types.variable,
    function = variable | Types.function,
    parameter = variable | Types.parameter,
    property = Types.member | Types.property,
    parameterProperty = parameter | property,
    method = Types.member | Types.method,
    class = Types.type | Types.class,
    interface = Types.type | Types.interface,
    typeAlias = Types.type | Types.typeAlias,
    genericTypeParameter = Types.type | Types.genericTypeParameter,
    enum = Types.type | Types.enum,
    enumMember = property | Types.enumMember,
    // tslint:enable:naming-convention
}

enum Modifiers {
    // tslint:disable:naming-convention
    const = 1,
    readonly = Modifiers.const,
    static = 1 << 1,
    public = 1 << 2,
    protected = 1 << 3,
    private = 1 << 4,
    global = 1 << 5,
    local = 1 << 6,
    abstract = 1 << 7,
    export = 1 << 8,
    import = 1 << 9,
    rename = 1 << 10,
    // tslint:enable:naming-convention
}

enum Specifity {
    // tslint:disable:naming-convention
    const = 1,
    readonly = Specifity.const,
    static = 1 << 1,
    global = Specifity.static,
    local = Specifity.static,
    public = 1 << 2,
    protected = Specifity.public,
    private = Specifity.public,
    abstract = 1 << 3,
    export = 1 << 4,
    import = 1 << 5,
    rename = 1 << 6,
    filter = 1 << 7,
    default = 1 << 8,
    variable = 2 << 8,
    function = 3 << 8,
    parameter = 4 << 8,
    member = 5 << 8,
    property = 6 << 8,
    method = Specifity.property,
    enumMember = 7 << 8,
    type = 8 << 8,
    class = 9 << 8,
    interface = Specifity.class,
    typeAlias = Specifity.class,
    genericTypeParameter = Specifity.class,
    enum = Specifity.class,
    // tslint:enable:naming-convention
}

type Format = 'camelCase' | 'PascalCase' | 'snake_case' | 'UPPER_CASE';
type IdentifierType = keyof typeof Types;
type Modifier = keyof typeof Modifiers;

type UnderscoreOption = 'allow' | 'require' | 'forbid';

interface IRuleScope {
    type: IdentifierType;
    modifiers?: Modifier | Modifier[];
    final?: boolean;
    filter?: string;
}

type RuleConfig = IRuleScope & Partial<IFormat>;

interface IFormat {
    format: Format|Format[]|undefined;
    leadingUnderscore: UnderscoreOption|undefined;
    trailingUnderscore: UnderscoreOption|undefined;
    prefix: string|string[]|undefined;
    suffix: string|string[]|undefined;
    regex: string|undefined;
}

export class Rule extends AbstractConfigDependentRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithWalker(new IdentifierNameWalker(
            sourceFile,
            this.ruleName,
            this.ruleArguments.map((rule) => new NormalizedConfig(rule)).sort(NormalizedConfig.sort),
        ));
    }
}

class NormalizedConfig {
    private _type: Types;
    private _filter: RegExp|undefined;
    private _format: Partial<IFormat>;
    private _modifiers: number;
    private _specifity: number;
    private _final: boolean;

    constructor(raw: RuleConfig) {
        this._type = Types[raw.type];
        this._final = !!raw.final;
        this._specifity = Specifity[raw.type];
        this._modifiers = 0;
        if (raw.modifiers !== undefined) {
            if (Array.isArray(raw.modifiers)) {
                for (const modifier of raw.modifiers) {
                    this._modifiers |= Modifiers[modifier];
                    this._specifity |= Specifity[modifier];
                }
            } else {
                this._modifiers = Modifiers[raw.modifiers];
                this._specifity |= Specifity[raw.modifiers];
            }
        }
        if (raw.filter !== undefined) {
            this._filter = new RegExp(raw.filter);
            this._specifity |= Specifity.filter;
        } else {
            this._filter = undefined;
        }
        this._format = raw;
    }

    public matches(type: TypeSelector, modifiers: number, name: string): [boolean, boolean] {
        if (this._final && type > this._type << 1) // check if TypeSelector has a higher bit set than this._type
            return [false, false];
        if ((this._type & type) === 0 || (this._modifiers & ~modifiers) !== 0)
            return [false, false];
        if (this._filter === undefined)
            return [true, false];
        return [this._filter.test(name), true];
    }

    public getFormat() {
        return this._format;
    }

    public static sort(first: NormalizedConfig, second: NormalizedConfig): number {
        return first._specifity - second._specifity;
    }
}

class NameChecker {
    private _format: Format|Format[]|undefined;
    private _leadingUnderscore: UnderscoreOption|undefined;
    private _trailingUnderscore: UnderscoreOption|undefined;
    private _prefix: string|string[]|undefined;
    private _suffix: string|string[]|undefined;
    private _regex: RegExp|undefined;
    constructor(private readonly _type: TypeSelector, format: IFormat) {
        this._leadingUnderscore = format.leadingUnderscore;
        this._trailingUnderscore = format.trailingUnderscore;
        this._format = parseOptionArray<Format>(format.format);
        this._prefix = parseOptionArray(format.prefix);
        this._suffix = parseOptionArray(format.suffix);
        this._regex = format.regex ? new RegExp(format.regex) : undefined;
    }

    private _failMessage(message: string): string {
        return TypeSelector[this._type] + message;
    }

    public check(name: ts.Identifier, walker: Lint.AbstractWalker<any>) {
        let identifier = name.text;

        // start with regex test before we potentially strip off underscores and affixes
        if (this._regex !== undefined && !this._regex.test(identifier))
            walker.addFailureAtNode(name, this._failMessage(REGEX_FAIL));

        if (this._leadingUnderscore) {
            if (identifier[0] === '_') {
                if (this._leadingUnderscore === 'forbid')
                    walker.addFailureAtNode(name, this._failMessage(LEADING_FAIL));
                identifier = identifier.slice(1);
            } else if (this._leadingUnderscore === 'require') {
                walker.addFailureAtNode(name, this._failMessage(NO_LEADING_FAIL));
            }
        }

        if (this._trailingUnderscore) {
            if (identifier[identifier.length - 1] === '_') {
                if (this._trailingUnderscore === 'forbid')
                    walker.addFailureAtNode(name, this._failMessage(TRAILING_FAIL));
                identifier = identifier.slice(0, -1);
            } else if (this._trailingUnderscore === 'require') {
                walker.addFailureAtNode(name, this._failMessage(NO_TRAILING_FAIL));
            }
        }

        if (this._prefix) {
            if (Array.isArray(this._prefix)) {
                identifier = this._checkPrefixes(identifier, name, this._prefix, walker);
            } else if (identifier.startsWith(this._prefix)) {
                identifier = identifier.slice(this._prefix.length);
            } else {
                walker.addFailureAtNode(name, this._failMessage(PREFIX_FAIL + this._prefix));
            }
        }
        if (this._suffix) {
            if (Array.isArray(this._suffix)) {
                identifier = this._checkSuffixes(identifier, name, this._suffix, walker);
            } else if (identifier.endsWith(this._suffix)) {
                identifier = identifier.slice(0, -this._suffix.length);
            } else {
                walker.addFailureAtNode(name, this._failMessage(SUFFIX_FAIL + this._suffix));
            }
        }

        // case checks
        if (this._format) {
            if (Array.isArray(this._format)) {
                if (!matchesAnyFormat(identifier, this._format))
                    walker.addFailureAtNode(name, this._failMessage(FORMAT_FAIL + formatFormatList(this._format)));
            } else if (!matchesFormat(identifier, this._format)) {
                walker.addFailureAtNode(name, this._failMessage(FORMAT_FAIL + this._format));
            }
        }
    }

    private _checkPrefixes(identifier: string, name: ts.Identifier, prefixes: string[], walker: Lint.AbstractWalker<any>): string {
        for (const prefix of prefixes)
            if (identifier.startsWith(prefix))
                return identifier.slice(prefix.length);
        walker.addFailureAtNode(name, this._failMessage(PREFIX_FAIL_ARR + prefixes.toString()));
        return identifier;
    }

    private _checkSuffixes(identifier: string, name: ts.Identifier, suffixes: string[], walker: Lint.AbstractWalker<any>): string {
        for (const suffix of suffixes)
            if (identifier.endsWith(suffix))
                return identifier.slice(-suffix.length);
        walker.addFailureAtNode(name, this._failMessage(SUFFIX_FAIL_ARR + suffixes.toString()));
        return identifier;
    }

}

class IdentifierNameWalker extends Lint.AbstractWalker<NormalizedConfig[]> {
    private _depth = 0;
    private _cache = new Map<string, NameChecker | null>();

    private _checkTypeParameters(node: ts.DeclarationWithTypeParameters, modifiers: Modifiers) {
        if (node.typeParameters !== undefined)
            for (const {name} of node.typeParameters)
                this._checkName(name, TypeSelector.genericTypeParameter, modifiers);
    }

    public visitEnumDeclaration(node: ts.EnumDeclaration) {
        let modifiers = this._getModifiers(node, TypeSelector.enum);
        this._checkName(node.name, TypeSelector.enum, modifiers);
        modifiers |= Modifiers.static | Modifiers.public | Modifiers.readonly; // treat enum members as public static readonly properties
        for (const {name} of node.members)
            if (utils.isIdentifier(name))
                this._checkName(name, TypeSelector.enumMember, modifiers);
    }

    public visitTypeAliasDeclaration(node: ts.TypeAliasDeclaration) {
        this._checkDeclaration(node, TypeSelector.typeAlias);
        this._checkTypeParameters(node, Modifiers.global);
    }

    public visitClassExpression(node: ts.ClassExpression) {
        if (node.name !== undefined)
            this._checkDeclaration(<ts.ClassExpression & {name: ts.Identifier}>node, TypeSelector.class);
        this._checkTypeParameters(node, Modifiers.global);
    }

    public visitClassDeclaration(node: ts.ClassDeclaration) {
        if (node.name !== undefined)
            this._checkDeclaration(<ts.ClassDeclaration & {name: ts.Identifier}>node, TypeSelector.class);
        this._checkTypeParameters(node, Modifiers.global);
    }

    public visitMethodDeclaration(node: ts.MethodDeclaration) {
        if (isNameIdentifier(node))
            this._checkDeclaration(node, TypeSelector.method);
        this._checkTypeParameters(node, Modifiers.local);
    }

    public visitInterfaceDeclaration(node: ts.InterfaceDeclaration) {
        this._checkDeclaration(node, TypeSelector.interface);
        this._checkTypeParameters(node, Modifiers.global);
    }

    public visitParameterDeclaration(node: ts.ParameterDeclaration) {
        if (isNameIdentifier(node)) {
            if (node.name.originalKeywordKind === ts.SyntaxKind.ThisKeyword)
                // exempt this parameter
                return;
            // param properties cannot be destructuring assignments
            this._checkDeclaration(node, utils.isParameterProperty(node) ? TypeSelector.parameterProperty
                                                                         : TypeSelector.parameter);
        } else {
            // handle destructuring
            utils.forEachDestructuringIdentifier(<ts.BindingPattern>node.name, (declaration) => {
                this._checkName(declaration.name,
                                TypeSelector.parameter,
                                Modifiers.local | (isEqualName(declaration.name, declaration.propertyName) ? 0 : Modifiers.rename));
            });
        }

    }

    public visitPropertyDeclaration(node: ts.PropertyDeclaration) {
        if (isNameIdentifier(node))
            this._checkDeclaration(node, TypeSelector.property);
    }

    public visitSetAccessor(node: ts.SetAccessorDeclaration) {
        if (isNameIdentifier(node))
            this._checkDeclaration(node, TypeSelector.property);
    }

    public visitGetAccessor(node: ts.GetAccessorDeclaration) {
        if (isNameIdentifier(node))
            this._checkDeclaration(node, TypeSelector.property);
    }

    private _checkVariableDeclarationList(list: ts.VariableDeclarationList, modifiers: number) {
        // compute modifiers once and reuse for all declared variables
        if ((list.flags & ts.NodeFlags.Const) !== 0)
            modifiers |= Modifiers.const;
        utils.forEachDeclaredVariable(list, (declaration) => {
            this._checkName(declaration.name,
                            TypeSelector.variable,
                            modifiers | (isEqualName(declaration.name, declaration.propertyName) ? 0 : Modifiers.rename));
        });
    }

    public visitForStatement(node: ts.ForStatement) {
        if (node.initializer !== undefined && utils.isVariableDeclarationList(node.initializer))
            this._checkVariableDeclarationList(node.initializer, this._getModifiers(node.initializer, TypeSelector.variable));
    }

    public visitForOfStatement(node: ts.ForOfStatement) {
        if (utils.isVariableDeclarationList(node.initializer))
            this._checkVariableDeclarationList(node.initializer, this._getModifiers(node.initializer, TypeSelector.variable));
    }

    public visitForInStatement(node: ts.ForInStatement) {
        if (utils.isVariableDeclarationList(node.initializer))
            this._checkVariableDeclarationList(node.initializer, this._getModifiers(node.initializer, TypeSelector.variable));
    }

    public visitVariableStatement(node: ts.VariableStatement) {
        // skip 'declare' keywords
        if (!utils.hasModifier(node.modifiers, ts.SyntaxKind.DeclareKeyword))
            this._checkVariableDeclarationList(node.declarationList, this._getModifiers(node, TypeSelector.variable));
    }

    public visitFunctionDeclaration(node: ts.FunctionDeclaration) {
        if (node.name !== undefined)
            this._checkDeclaration(<ts.FunctionDeclaration & {name: ts.Identifier}>node, TypeSelector.function);
        this._checkTypeParameters(node, Modifiers.local);
    }

    public visitFuncitonExpression(node: ts.FunctionExpression) {
        if (node.name !== undefined)
            this._checkDeclaration(<ts.FunctionExpression & {name: ts.Identifier}>node, TypeSelector.function);
        this._checkTypeParameters(node, Modifiers.local);
    }

    public visitArrowFunction(node: ts.ArrowFunction) {
        this._checkTypeParameters(node, Modifiers.local);
    }

    private _checkDeclaration(node: DeclarationWithIdentifierName, type: TypeSelector) {
        this._checkName(node.name, type, this._getModifiers(node, type));
    }

    private _checkName(name: ts.Identifier, type: TypeSelector, modifiers: number) {
        const matchingChecker = this._getMatchingChecker(type, modifiers, name.text);
        if (matchingChecker !== null) // tslint:disable-line:no-null-keyword
            matchingChecker.check(name, this);
    }

    private _getMatchingChecker(type: TypeSelector, modifiers: number, name: string): NameChecker|null {
        const key = `${type},${modifiers}`;
        const cached = this._cache.get(key);
        if (cached !== undefined)
            return cached;

        const [checker, hasFilter] = this._createChecker(type, modifiers, name);
        if (!hasFilter) // only cache if there is no filter for the name
            this._cache.set(key, checker);
        return checker;
    }

    private _createChecker(type: TypeSelector, modifiers: number, name: string): [NameChecker|null, boolean] {
        let hasFilter = false;
        const config = this.options.reduce(
            (format: IFormat, rule) => {
                const [matches, filterUsed] = rule.matches(type, modifiers, name);
                if (!matches)
                    return format;
                if (filterUsed)
                    hasFilter = true;
                return Object.assign(format, rule.getFormat()); // tslint:disable-line:prefer-object-spread
            },
            {
                leadingUnderscore: undefined,
                trailingUnderscore: undefined,
                format: undefined,
                prefix: undefined,
                regex: undefined,
                suffix : undefined,
            });

        // ohne Regeln kein Checker
        if (!config.leadingUnderscore &&
            !config.trailingUnderscore &&
            !config.format &&
            !config.prefix &&
            !config.regex &&
            !config.suffix)
            return [null, hasFilter]; // tslint:disable-line:no-null-keyword
        return [new NameChecker(type, config), hasFilter];
    }

    private _getModifiers(node: ts.Node, type: TypeSelector): number {
        let modifiers = 0;
        if (node.modifiers !== undefined) {
            if (type | Types.member) { // property, method, parameter property
                if (utils.hasModifier(node.modifiers, ts.SyntaxKind.PrivateKeyword)) {
                    modifiers |= Modifiers.private;
                } else if (utils.hasModifier(node.modifiers, ts.SyntaxKind.ProtectedKeyword)) {
                    modifiers |= Modifiers.protected;
                } else {
                    modifiers |= Modifiers.public;
                }
                if (utils.hasModifier(node.modifiers, ts.SyntaxKind.ReadonlyKeyword))
                    modifiers |= Modifiers.const;
                if (utils.hasModifier(node.modifiers, ts.SyntaxKind.StaticKeyword))
                    modifiers |= Modifiers.static;
            }
            if (utils.hasModifier(node.modifiers, ts.SyntaxKind.ConstKeyword)) // stuff like const enums
                modifiers |= Modifiers.const;
            if (utils.hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword))
                modifiers |= Modifiers.export;
            if (utils.hasModifier(node.modifiers, ts.SyntaxKind.AbstractKeyword))
                modifiers |= Modifiers.abstract;
        }

        if (type !== TypeSelector.property && type !== TypeSelector.method)
            modifiers |= this._depth !== 0 ? Modifiers.local : Modifiers.global;

        return modifiers;
    }

    public walk(sourceFile: ts.Node) {
        const cb = (node: ts.Node): void => {
            this.visitNode(node);
            if (utils.isScopeBoundary(node)) {
                ++this._depth;
                ts.forEachChild(node, cb);
                --this._depth;
            } else {
                return ts.forEachChild(node, cb);
            }
        };
        return ts.forEachChild(sourceFile, cb);
    }

    public visitNode(node: ts.Node) {
        switch (node.kind) {
            case ts.SyntaxKind.VariableStatement:
                return this.visitVariableStatement(<ts.VariableStatement>node);
            case ts.SyntaxKind.FunctionDeclaration:
                return this.visitFunctionDeclaration(<ts.FunctionDeclaration>node);
            case ts.SyntaxKind.FunctionExpression:
                return this.visitFuncitonExpression(<ts.FunctionExpression>node);
            case ts.SyntaxKind.ForStatement:
                return this.visitForStatement(<ts.ForStatement>node);
            case ts.SyntaxKind.ForInStatement:
                return this.visitForInStatement(<ts.ForInStatement>node);
            case ts.SyntaxKind.ForOfStatement:
                return this.visitForOfStatement(<ts.ForOfStatement>node);
            case ts.SyntaxKind.Parameter:
                return this.visitParameterDeclaration(<ts.ParameterDeclaration>node);
            case ts.SyntaxKind.ClassDeclaration:
                return this.visitClassDeclaration(<ts.ClassDeclaration>node);
            case ts.SyntaxKind.ClassExpression:
                return this.visitClassExpression(<ts.ClassExpression>node);
            case ts.SyntaxKind.InterfaceDeclaration:
                return this.visitInterfaceDeclaration(<ts.InterfaceDeclaration>node);
            case ts.SyntaxKind.EnumDeclaration:
                return this.visitEnumDeclaration(<ts.EnumDeclaration>node);
            case ts.SyntaxKind.TypeAliasDeclaration:
                return this.visitTypeAliasDeclaration(<ts.TypeAliasDeclaration>node);
            case ts.SyntaxKind.PropertyDeclaration:
                return this.visitPropertyDeclaration(<ts.PropertyDeclaration>node);
            case ts.SyntaxKind.MethodDeclaration:
                return this.visitMethodDeclaration(<ts.MethodDeclaration>node);
            case ts.SyntaxKind.GetAccessor:
                return this.visitGetAccessor(<ts.GetAccessorDeclaration>node);
            case ts.SyntaxKind.SetAccessor:
                return this.visitSetAccessor(<ts.SetAccessorDeclaration>node);
            case ts.SyntaxKind.ArrowFunction:
                return this.visitArrowFunction(<ts.ArrowFunction>node);
        }
    }
}

function parseOptionArray<T>(option?: T|T[]): T|T[]|undefined {
    if (!Array.isArray(option) || option.length > 1)
        return option;
    return option[0];
}

function matchesFormat(identifier: string, format: Format): boolean {
    switch (format) {
        case PASCAL_OPTION:
            return isPascalCase(identifier);
        case CAMEL_OPTION:
            return isCamelCase(identifier);
        case SNAKE_OPTION:
            return isSnakeCase(identifier);
        case UPPER_OPTION:
            return isUpperCase(identifier);
    }
}

function matchesAnyFormat(identifier: string, formats: Format[]): boolean {
    for (const format of formats)
        if (matchesFormat(identifier, format))
            return true;
    return false;
}

function formatFormatList(formats: Format[]): string {
    let result = formats[0];
    const lastIndex = formats.length - 1;
    for (let i = 1; i < lastIndex; ++i)
        result += ', ' + formats[i];
    return result + ' or ' + formats[lastIndex];
}

function isPascalCase(name: string) {
    return name.length === 0 || name[0] === name[0].toUpperCase() && hasStrictCamelHumps(name, true);
}

function isCamelCase(name: string) {
    return name.length === 0 || name[0] === name[0].toLowerCase() && hasStrictCamelHumps(name, false);
}

function hasStrictCamelHumps(name: string, isUpper: boolean) {
    if (name[0] === '_')
        return false;
    for (let i = 1; i < name.length; ++i) {
        if (name[i] === '_')
            return false;
        if (isUpper === isUppercaseChar(name[i])) {
            if (isUpper)
                return false;
        } else {
            isUpper = !isUpper;
        }
    }
    return true;
}

function isUppercaseChar(char: string) {
    return char === char.toUpperCase() && char !== char.toLowerCase();
}

function isSnakeCase(name: string) {
    return name === name.toLowerCase() && validateUnderscores(name);
}

function isUpperCase(name: string) {
    return name === name.toUpperCase() && validateUnderscores(name);
}

/** Check for leading trailing and adjacent underscores */
function validateUnderscores(name: string) {
    if (name[0] === '_')
        return false;
    let wasUnderscore = false;
    for (let i = 1; i < name.length; ++i) {
        if (name[i] === '_') {
            if (wasUnderscore)
                return false;
            wasUnderscore = true;
        } else {
            wasUnderscore = false;
        }
    }
    return !wasUnderscore;
}

function isNameIdentifier(node: ts.Declaration & {name: ts.DeclarationName}): node is DeclarationWithIdentifierName {
    return node.name.kind === ts.SyntaxKind.Identifier;
}

function isEqualName(name: ts.Identifier, propertyName?: ts.PropertyName) {
    return propertyName === undefined ||
        (propertyName.kind === ts.SyntaxKind.Identifier && propertyName.text === name.text);
}
