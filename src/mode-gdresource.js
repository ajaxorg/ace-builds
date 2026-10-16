define("ace/mode/gdscript_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module){"use strict";
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var GDScriptHighlightRules = function () {
    var eolStates = {
        signal_declaration: true,
        lambda_declaration: true,
        function_declaration: true,
        variable_declaration: true
    };
    var popState = function (stack) {
        stack.shift();
        return stack.shift() || "start";
    };
    var popAtEol = function (currentState, stack) {
        var parent = popState(stack);
        while (eolStates[parent])
            parent = popState(stack);
        return parent;
    };
    var nodePathPush = [{
            token: "paren.rparen",
            regex: /\)(?=$)/,
            next: popAtEol
        }, {
            token: "paren.rparen",
            regex: /\)/,
            next: "pop"
        }, {
            token: "string",
            regex: /"/,
            push: [{
                    token: "string",
                    regex: /"/,
                    next: "pop"
                }, {
                    token: "keyword.control.flow.gdscript",
                    regex: /%/
                }, {
                    defaultToken: "string"
                }]
        }, {
            token: "string",
            regex: /'/,
            push: [{
                    token: "string",
                    regex: /'/,
                    next: "pop"
                }, {
                    token: "keyword.control.flow.gdscript",
                    regex: /%/
                }, {
                    defaultToken: "string"
                }]
        }, {
            defaultToken: "meta.literal.nodepath.gdscript"
        }];
    var nodePathFuncPush = __spreadArray(__spreadArray([], __read(nodePathPush), false), [{ "include": "#expression" }], false);
    this.$rules = {
        start: [{
                include: "#statement"
            }, {
                include: "#expression"
            }],
        "#statement": [{
                include: "#extends_statement"
            }],
        "#statement_keyword": [{
                token: "keyword.control.flow.gdscript",
                regex: /\b(?<!\.)(?:continue|assert|break|elif|else|if|pass|return|while)\b/
            }, {
                token: "storage.type.class.gdscript",
                regex: /\b(?<!\.)class\b/
            }, {
                token: ["text", "keyword.control.flow.gdscript"],
                regex: /(?:^|:)(\s*)(case|match)(?=\s*(?:[-+\w\d(\[{'":#]|$))\b/
            }],
        "#extends_statement": [{
                token: [
                    "keyword.language.gdscript",
                    "text",
                    "entity.other.inherited-class.gdscript"
                ],
                regex: /(extends)(\s+)((?:[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)|(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/
            }],
        "#expression": [{
                include: "#getter_setter_godot4"
            }, {
                include: "#class_declaration"
            }, {
                include: "#class_name"
            }, {
                include: "#class_new"
            }, {
                include: "#base_expression"
            }, {
                include: "#assignment_operator"
            }, {
                include: "#annotations"
            }, {
                include: "#builtin_classes"
            }, {
                include: "#class_is"
            }, {
                include: "#class_enum"
            }, {
                include: "#any_method"
            }, {
                include: "#any_variable"
            }, {
                include: "#any_property"
            }],
        "#base_expression": [{
                include: "#builtin_get_node_shorthand"
            }, {
                include: "#nodepath_object"
            }, {
                include: "#strings"
            }, {
                include: "#builtin_classes"
            }, {
                include: "#const_vars"
            }, {
                include: "#keywords"
            }, {
                include: "#operators"
            }, {
                include: "#lambda_declaration"
            }, {
                include: "#variable_declaration"
            }, {
                include: "#signal_declaration_bare"
            }, {
                include: "#signal_declaration"
            }, {
                include: "#function_declaration"
            }, {
                include: "#statement_keyword"
            }, {
                include: "#assignment_operator"
            }, {
                include: "#in_keyword"
            }, {
                include: "#control_flow"
            }, {
                include: "#match_keyword"
            }, {
                include: "#curly_braces"
            }, {
                include: "#square_braces"
            }, {
                include: "#round_braces"
            }, {
                include: "#function_call"
            }, {
                include: "#region"
            }, {
                include: "#comment"
            }, {
                include: "#func"
            }, {
                include: "#letter"
            }, {
                include: "#numbers"
            }, {
                include: "#pascal_case_class"
            }, {
                include: "#line_continuation"
            }],
        "#region": [{
                token: "keyword.language.region.gdscript",
                regex: /#(?:end)?region.*$/
            }],
        "#comment": [{
                token: "comment",
                regex: /(?:##|#).*$/
            }],
        "#strings": [{
                token: [
                    "constant.character.escape.gdscript",
                    "string"
                ],
                regex: /((?:r)?)(""")/,
                push: [{
                        token: "string",
                        regex: /"""(?=$)/,
                        next: popAtEol
                    }, {
                        token: "string",
                        regex: /"""/,
                        next: "pop"
                    }, {
                        token: "constant.character.escape.gdscript",
                        regex: /\\./
                    }, {
                        include: "#string_percent_placeholders"
                    }, {
                        include: "#string_bracket_placeholders"
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: [
                    "constant.character.escape.gdscript",
                    "string"
                ],
                regex: /((?:r)?)(''')/,
                push: [{
                        token: "string",
                        regex: /'''(?=$)/,
                        next: popAtEol
                    }, {
                        token: "string",
                        regex: /'''/,
                        next: "pop"
                    }, {
                        token: "constant.character.escape.gdscript",
                        regex: /\\./
                    }, {
                        include: "#string_percent_placeholders"
                    }, {
                        include: "#string_bracket_placeholders"
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: [
                    "constant.character.escape.gdscript",
                    "string"
                ],
                regex: /((?:r)?)(")/,
                push: [{
                        token: "string",
                        regex: /"(?=$)/,
                        next: popAtEol
                    }, {
                        token: "string",
                        regex: /"/,
                        next: "pop"
                    }, {
                        token: "constant.character.escape.gdscript",
                        regex: /\\./
                    }, {
                        include: "#string_percent_placeholders"
                    }, {
                        include: "#string_bracket_placeholders"
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: [
                    "constant.character.escape.gdscript",
                    "string"
                ],
                regex: /((?:r)?)(')/,
                push: [{
                        token: "string",
                        regex: /'(?=$)/,
                        next: popAtEol
                    }, {
                        token: "string",
                        regex: /'/,
                        next: "pop"
                    }, {
                        token: "constant.character.escape.gdscript",
                        regex: /\\./
                    }, {
                        include: "#string_percent_placeholders"
                    }, {
                        include: "#string_bracket_placeholders"
                    }, {
                        defaultToken: "string"
                    }]
            }],
        "#string_percent_placeholders": [{
                token: "constant.character.format.other.gdscript",
                regex: /%(?:\([\w\s]*\))?[-+#0 ]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:[hlL])?[diouxXeEfFgGcrsab%]/
            }],
        "#string_bracket_placeholders": [{
                token: [
                    "constant.character.format.other.gdscript",
                    "constant.character.format.other.gdscript",
                    "constant.character.format.other.gdscript",
                    "constant.character.format.other.gdscript",
                    "storage.type.format.gdscript",
                    "storage.type.format.gdscript",
                    "constant.character.format.other.gdscript"
                ],
                regex: /({{)|(}})|({\w*)((?:\.[A-Za-z_]\w*|\[[^\]'"]+\])*)((?:![rsa])?)((?::\w?[<>=^]?[-+ ]?\#?\d*,?(?:\.\d+)?[bcdeEfFgGnosxX%]?)?)(})/
            }, {
                token: [
                    "constant.character.format.other.gdscript",
                    "constant.character.format.other.gdscript",
                    "storage.type.format.gdscript",
                    "storage.type.format.gdscript",
                    "constant.character.format.other.gdscript",
                    "constant.character.format.other.gdscript"
                ],
                regex: /({\w*)((?:\.[A-Za-z_]\w*|\[[^\]'"]+\])*)((?:![rsa])?)(:)((?:[^'"{}])*(?:\{(?:[^'"}])*\}(?:[^'"{}])*)*)(})/
            }],
        "#nodepath_object": [{
                token: ["support.class.library.gdscript", "text", "paren.lparen"],
                regex: /(NodePath)(\s*)(\()/,
                push: nodePathPush
            }, {
                token: ["entity.name.function.gdscript", "text", "paren.lparen"],
                regex: /(get_node_or_null|has_node|has_node_and_resource|find_node|get_node)(\s*)(\()/,
                push: nodePathFuncPush
            }],
        "#func": [{
                token: "keyword.language.gdscript storage.type.function.gdscript",
                regex: /\bfunc\b/
            }],
        "#in_keyword": [{
                token: "keyword.control.gdscript",
                regex: /\bfor\b/,
                push: [{
                        token: "text",
                        regex: /:/,
                        next: "pop"
                    }, {
                        token: "keyword.control.gdscript",
                        regex: /\bin\b/
                    }, {
                        include: "#base_expression"
                    }, {
                        include: "#any_variable"
                    }, {
                        include: "#any_property"
                    }]
            }, {
                token: "keyword.operator.wordlike.gdscript",
                regex: /\bin\b/
            }],
        "#operators": [{
                include: "#wordlike_operator"
            }, {
                include: "#boolean_operator"
            }, {
                include: "#arithmetic_operator"
            }, {
                include: "#bitwise_operator"
            }, {
                include: "#compare_operator"
            }],
        "#wordlike_operator": [{
                token: "keyword.operator.wordlike.gdscript",
                regex: /\b(?:and|or|not)\b/
            }],
        "#boolean_operator": [{
                token: "keyword.operator.boolean.gdscript",
                regex: /&&|\|\|/
            }],
        "#bitwise_operator": [{
                token: "keyword.operator.bitwise.gdscript",
                regex: /&|\||<<=|>>=|<<|>>|\^|~/
            }],
        "#compare_operator": [{
                token: "keyword.operator.comparison.gdscript",
                regex: /<=|>=|==|<|>|!=|!/
            }],
        "#arithmetic_operator": [{
                token: "keyword.operator.arithmetic.gdscript",
                regex: /->|\+=|-=|\*\*=|\*=|\^=|\/=|%=|&=|~=|\|=|\*\*|\*|\/|%|\+|-/
            }],
        "#assignment_operator": [{
                token: "keyword.operator.assignment.gdscript",
                regex: /=/
            }],
        "#control_flow": [{
                token: "keyword.control.gdscript",
                regex: /\b(?:if|elif|else|while|break|continue|pass|return|when|yield|await)\b/
            }],
        "#match_keyword": [{
                token: ["text", "keyword.control.flow.gdscript"],
                regex: /(?:^|:)(\s*)(match)\b/
            }],
        "#keywords": [{
                token: "keyword.language.gdscript",
                regex: /\b(?:class|class_name|is|onready|tool|static|export|as|enum|assert|breakpoint|sync|remote|master|puppet|slave|remotesync|mastersync|puppetsync|trait|namespace|super|self)\b/
            }],
        "#letter": [{
                token: "constant.language.gdscript",
                regex: /\b(?:true|false|null)\b/
            }],
        "#numbers": [{
                token: "constant.numeric.integer.binary.gdscript",
                regex: /0b[01_]+/
            }, {
                token: "constant.numeric.integer.hexadecimal.gdscript",
                regex: /0x[0-9A-Fa-f_]+/
            }, {
                token: "constant.numeric.float.gdscript",
                regex: /\.[0-9][0-9_]*(?:[eE][+-]?[0-9_]+)?/
            }, {
                token: "constant.numeric.float.gdscript",
                regex: /[0-9][0-9_]*\.[0-9_]*(?:[eE][+-]?[0-9_]+)?/
            }, {
                token: "constant.numeric.float.gdscript",
                regex: /(?:[0-9][0-9_]*)?\.[0-9_]*[eE][+-]?[0-9_]+/
            }, {
                token: "constant.numeric.float.gdscript",
                regex: /[0-9][0-9_]*[eE][+-]?[0-9_]+/
            }, {
                token: "constant.numeric.integer.gdscript",
                regex: /[-]?[0-9][0-9_]*/
            }],
        "#variable_declaration": [{
                token: [
                    "keyword.language.gdscript storage.type.var.gdscript",
                    "keyword.language.gdscript storage.type.const.gdscript"
                ],
                regex: /\b(?:(var)|(const))\b/,
                stateName: "variable_declaration",
                push: [{
                        token: "meta.variable.declaration.gdscript",
                        regex: /$|;/,
                        next: "pop"
                    }, {
                        token: [
                            "punctuation.separator.annotation.gdscript",
                            "text",
                            "entity.name.function.gdscript",
                            "text",
                            "entity.name.function.gdscript"
                        ],
                        regex: /((?::)?)(\s*)(set|get)(\s+=\s+)([a-zA-Z_]\w*)/
                    }, {
                        token: "keyword.operator.assignment.gdscript",
                        regex: /:=|=(?!=)/
                    }, {
                        token: [
                            "punctuation.separator.annotation.gdscript",
                            "text",
                            "entity.name.type.class.gdscript"
                        ],
                        regex: /(:)(\s*)((?:[a-zA-Z_]\w*)?)/
                    }, {
                        token: [
                            "keyword.language.gdscript",
                            "text",
                            "entity.name.function.gdscript",
                            "text",
                            "entity.name.function.gdscript"
                        ],
                        regex: /(setget)(\s+)([a-zA-Z_]\w*)(?:([,]\s*)([a-zA-Z_]\w*))?/
                    }, {
                        include: "#expression"
                    }, {
                        include: "#letter"
                    }, {
                        include: "#any_variable"
                    }, {
                        include: "#any_property"
                    }, {
                        include: "#keywords"
                    }, {
                        defaultToken: "meta.variable.declaration.gdscript"
                    }]
            }],
        "#getter_setter_godot4": [{
                token: [
                    "entity.name.function.gdscript",
                    "text",
                    "punctuation.separator.annotation.gdscript"
                ],
                regex: /(get)(\s*)(:)/
            }, {
                token: [
                    "entity.name.function.gdscript",
                    "text",
                    "paren.lparen",
                    "text",
                    "variable.other.gdscript",
                    "text",
                    "paren.rparen",
                    "text",
                    "punctuation.separator.annotation.gdscript"
                ],
                regex: /(set)(\s*)(\()(\s*)([A-Za-z_]\w*)(\s*)(\))(\s*)(:)/
            }],
        "#class_declaration": [{
                token: [
                    "storage.type.class.gdscript",
                    "text",
                    "entity.name.type.class.gdscript",
                    "text"
                ],
                regex: /\b(?<!\.)(class)(\s+)([a-zA-Z_]\w*)(\s*)(?=:)/
            }],
        "#class_new": [{
                token: [
                    "entity.name.type.class.gdscript",
                    "text",
                    "storage.type.new.gdscript"
                ],
                regex: /\b([a-zA-Z_]\w*)(\.)(new)(?=\()/
            }],
        "#class_is": [{
                token: [
                    "text",
                    "storage.type.is.gdscript",
                    "text",
                    "storage.type.not.gdscript",
                    "text",
                    "entity.name.type.class.gdscript"
                ],
                regex: /(\s+)(is)(\s+)(not)(\s+)([a-zA-Z_]\w*)\b/
            }],
        "#class_enum": [{
                token: [
                    "entity.name.type.class.gdscript",
                    "text",
                    "variable.other.enummember.gdscript"
                ],
                regex: /\b([A-Z][a-zA-Z_0-9]*)(\.)([A-Z_0-9]+)/
            }],
        "#class_name": [{
                token: [
                    "keyword.language.gdscript",
                    "text",
                    "entity.name.type.class.gdscript",
                    "class.other.gdscript"
                ],
                regex: /\b(class_name)(\s+)([a-zA-Z_]\w*)((?:\.[a-zA-Z_]\w*)?)/
            }],
        "#builtin_get_node_shorthand": [{
                include: "#builtin_get_node_shorthand_quoted"
            }, {
                include: "#builtin_get_node_shorthand_bare"
            }, {
                include: "#builtin_get_node_shorthand_bare_multi"
            }],
        "#builtin_get_node_shorthand_quoted": [{
                token: [
                    "keyword.control.flow.gdscript",
                    "variable.other.enummember.gdscript",
                    "string"
                ],
                regex: /(?:(\$|%)|(&|\^|@))(")/,
                push: [{
                        token: "string",
                        regex: /"(?=$)/,
                        next: popAtEol
                    }, {
                        token: "string",
                        regex: /"/,
                        next: "pop"
                    }, {
                        token: "keyword.control.flow",
                        regex: /%/
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: [
                    "keyword.control.flow.gdscript",
                    "variable.other.enummember.gdscript",
                    "string"
                ],
                regex: /(?:(\$|%)|(&|\^|@))(')/,
                push: [{
                        token: "string",
                        regex: /'(?=$)/,
                        next: popAtEol
                    }, {
                        token: "string",
                        regex: /'/,
                        next: "pop"
                    }, {
                        token: "keyword.control.flow",
                        regex: /%/
                    }, {
                        defaultToken: "string"
                    }]
            }],
        "#builtin_get_node_shorthand_bare": [{
                token: [
                    "keyword.control.flow.gdscript",
                    "constant.character.escape.gdscript",
                    "constant.character.escape.gdscript"
                ],
                regex: /(?<!\/\s*)(\$\s*|%|\$%\s*)((?:\/\s*)?)([a-zA-Z_]\w*)\b(?!\s*\/)/
            }],
        "#builtin_get_node_shorthand_bare_multi": [{
                token: [
                    "keyword.control.flow.gdscript",
                    "constant.character.escape.gdscript",
                    "constant.character.escape.gdscript"
                ],
                regex: /(\$\s*|%|\$%\s*)((?:\/\s*)?)([a-zA-Z_]\w*)/,
                push: [{
                        token: "meta.literal.nodepath.bare.gdscript",
                        regex: /(?=$)/,
                        next: popAtEol
                    }, {
                        token: "meta.literal.nodepath.bare.gdscript",
                        regex: /(?!\s*\/\s*%?\s*[a-zA-Z_]\w*)/,
                        next: "pop"
                    }, {
                        token: [
                            "constant.character.escape.gdscript",
                            "text",
                            "keyword.control.flow.gdscript",
                            "text",
                            "constant.character.escape.gdscript",
                            "text"
                        ],
                        regex: /(\/)(\s*)((?:%)?)(\s*)([a-zA-Z_]\w*)(\s*)/
                    }, {
                        defaultToken: "meta.literal.nodepath.bare.gdscript"
                    }]
            }],
        "#annotations": [{
                token: [
                    "entity.name.function.decorator.gdscript",
                    "entity.name.function.decorator.gdscript"
                ],
                regex: /(@)(abstract|export|export_category|export_color_no_alpha|export_custom|export_dir|export_enum|export_exp_easing|export_file|export_file_path|export_flags|export_flags_2d_navigation|export_flags_2d_physics|export_flags_2d_render|export_flags_3d_navigation|export_flags_3d_physics|export_flags_3d_render|export_flags_avoidance|export_global_dir|export_global_file|export_group|export_multiline|export_node_path|export_placeholder|export_range|export_storage|export_subgroup|export_tool_button|icon|onready|rpc|static_unload|tool|warning_ignore|warning_ignore_restore|warning_ignore_start)\b/
            }],
        "#builtin_classes": [{
                token: "entity.name.type.class.builtin.gdscript",
                regex: /(?<![^.]\.|:)\b(?:Vector2|Vector2i|Vector3|Vector3i|Vector4|Vector4i|Color|Rect2|Rect2i|Array|Basis|Dictionary|Plane|Quat|RID|Rect3|Transform|Transform2D|Transform3D|AABB|String|Color|NodePath|PoolByteArray|PoolIntArray|PoolRealArray|PoolStringArray|PoolVector2Array|PoolVector3Array|PoolColorArray|bool|int|float|Signal|Callable|StringName|Quaternion|Projection|PackedByteArray|PackedInt32Array|PackedInt64Array|PackedFloat32Array|PackedFloat64Array|PackedStringArray|PackedVector2Array|PackedVector2iArray|PackedVector3Array|PackedVector3iArray|PackedVector4Array|PackedColorArray|JSON|UPNP|OS|IP|JSONRPC|XRVRS|Variant|void)\b/
            }],
        "#const_vars": [{
                token: "variable.other.constant.gdscript",
                regex: /\b[A-Z_][A-Z_0-9]*\b/
            }],
        "#pascal_case_class": [{
                token: "entity.name.type.class.gdscript",
                regex: /\b[A-Z]+(?:[a-z]+[A-Za-z0-9_]*)+\b/
            }],
        "#signal_declaration_bare": [{
                token: [
                    "text",
                    "keyword.language.gdscript storage.type.function.gdscript",
                    "text",
                    "entity.name.function.gdscript"
                ],
                regex: /(\s*)(signal)(\s+)([a-zA-Z_]\w*)(?=$|\s)/
            }],
        "#signal_declaration": [{
                token: [
                    "text",
                    "keyword.language.gdscript storage.type.function.gdscript",
                    "text",
                    "entity.name.function.gdscript",
                    "text"
                ],
                regex: /(\s*)(signal)(\s+)([a-zA-Z_]\w*)(\s*)(?=\()/,
                stateName: "signal_declaration",
                push: [{
                        token: "empty",
                        regex: /(?=#|'|"|$)/,
                        next: "pop"
                    }, {
                        include: "#parameters"
                    }, {
                        include: "#line_continuation"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#lambda_declaration": [{
                token: [
                    "keyword.language.gdscript storage.type.function.gdscript",
                    "text"
                ],
                regex: /(func)(\s?)(?=\()/,
                stateName: "lambda_declaration",
                push: [{
                        token: "meta.function.gdscript",
                        regex: /:(?=$)/,
                        next: popAtEol
                    }, {
                        token: "meta.function.gdscript",
                        regex: /:|(?=#|'|"|$)/,
                        next: "pop"
                    }, {
                        include: "#parameters"
                    }, {
                        include: "#line_continuation"
                    }, {
                        include: "#base_expression"
                    }, {
                        include: "#any_variable"
                    }, {
                        include: "#any_property"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#function_declaration": [{
                token: [
                    "text",
                    "keyword.language.gdscript storage.type.function.gdscript",
                    "text",
                    "entity.name.function.gdscript",
                    "text"
                ],
                regex: /(\s*)(func)(\s+)([a-zA-Z_]\w*)(\s*)(?=\()/,
                stateName: "function_declaration",
                push: [{
                        token: [
                            "punctuation.section.function.begin.gdscript",
                            "empty"
                        ],
                        regex: /(:)|($)/,
                        next: "pop"
                    }, {
                        include: "#parameters"
                    }, {
                        include: "#line_continuation"
                    }, {
                        include: "#base_expression"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#parameters": [{
                token: "paren.lparen",
                regex: /\(/,
                push: [{
                        token: "paren.rparen",
                        regex: /\)(?=$)/,
                        next: popAtEol
                    }, {
                        token: "paren.rparen",
                        regex: /\)/,
                        next: "pop"
                    }, {
                        include: "#annotated_parameter"
                    }, {
                        token: [
                            "variable.parameter.function.language.gdscript",
                            "text",
                            "punctuation.separator.parameters.gdscript"
                        ],
                        regex: /([a-zA-Z_]\w*)(\s*)(?:(,)|(?=$|[)#=]))/
                    }, {
                        include: "#comment"
                    }, {
                        include: "#loose_default"
                    }, {
                        defaultToken: "meta.function.parameters.gdscript"
                    }]
            }],
        "#loose_default": [{
                token: "keyword.operator.gdscript",
                regex: /=/,
                push: [{
                        token: "punctuation.separator.parameters.gdscript",
                        regex: /,|(?=\))/,
                        next: "pop"
                    }, {
                        include: "#expression"
                    }]
            }],
        "#annotated_parameter": [{
                token: [
                    "text",
                    "variable.parameter.function.language.gdscript",
                    "text",
                    "punctuation.separator.annotation.gdscript",
                    "text",
                    "entity.name.type.class.gdscript"
                ],
                regex: /(\s*)([a-zA-Z_]\w*)(\s*)(:)(\s*)((?:[a-zA-Z_]\w*)?)/,
                push: [{
                        token: "punctuation.separator.parameters.gdscript",
                        regex: /,|(?=\))/,
                        next: "pop"
                    }, {
                        include: "#expression"
                    }, {
                        token: "keyword.operator.assignment.gdscript",
                        regex: /=(?!=)/
                    }]
            }],
        "#curly_braces": [{
                token: "paren.lparen",
                regex: /\{/,
                push: [{
                        token: "paren.rparen",
                        regex: /\}(?=$)/,
                        next: popAtEol
                    }, {
                        token: "paren.rparen",
                        regex: /\}/,
                        next: "pop"
                    }, {
                        include: "#base_expression"
                    }, {
                        include: "#any_variable"
                    }]
            }],
        "#square_braces": [{
                token: "paren.lparen",
                regex: /\[/,
                push: [{
                        token: "paren.rparen",
                        regex: /\](?=$)/,
                        next: popAtEol
                    }, {
                        token: "paren.rparen",
                        regex: /\]/,
                        next: "pop"
                    }, {
                        include: "#base_expression"
                    }, {
                        include: "#any_variable"
                    }]
            }],
        "#round_braces": [{
                token: "paren.lparen",
                regex: /\(/,
                push: [{
                        token: "paren.rparen",
                        regex: /\)(?=$)/,
                        next: popAtEol
                    }, {
                        token: "paren.rparen",
                        regex: /\)/,
                        next: "pop"
                    }, {
                        include: "#base_expression"
                    }, {
                        include: "#any_variable"
                    }]
            }],
        "#line_continuation": [{
                token: [
                    "punctuation.separator.continuation.line.gdscript",
                    "text",
                    "invalid.illegal.line.continuation.gdscript"
                ],
                regex: /(\\)(\s*)(\S.*$)/
            }, {
                token: [
                    "punctuation.separator.continuation.line.gdscript",
                    "text"
                ],
                regex: /(\\)(\s*$)/,
                push: [{
                        token: "text",
                        regex: /(?=^\s*$)|(?!\s*[rR]?(?:'''|"""|'|")|(?![\s\S]))/,
                        next: "pop"
                    }, {
                        include: "#base_expression"
                    }]
            }],
        "#any_method": [{
                token: "entity.name.function.other.gdscript",
                regex: /\b[A-Za-z_]\w*\b(?=\s*[(])/
            }],
        "#any_variable": [{
                token: "variable.other.gdscript",
                regex: /\b(?<![@\$#%])[A-Za-z_]\w*\b(?![(])/
            }],
        "#any_property": [{
                token: function (value) {
                    var match = /^\.(\s*)(.*)$/.exec(value);
                    var property = match[2];
                    var tokens = [{
                            type: "punctuation.accessor.gdscript",
                            value: "."
                        }];
                    if (match[1]) {
                        tokens.push({
                            type: "text",
                            value: match[1]
                        });
                    }
                    tokens.push({
                        type: /^[A-Z_][A-Z_0-9]*$/.test(property)
                            ? "constant.language.gdscript"
                            : "variable.other.property.gdscript",
                        value: property
                    });
                    return tokens;
                },
                regex: /(?<=\w)\.\s*(?:[A-Z_][A-Z_0-9]*|[A-Za-z_]\w*)\b(?![(])/
            }],
        "#function_call": [{
                token: "meta.function-call.gdscript",
                regex: /(?=\b[a-zA-Z_]\w*\b\s*\()/,
                push: [{
                        token: "paren.rparen",
                        regex: /\)(?=$)/,
                        next: popAtEol
                    }, {
                        token: "paren.rparen",
                        regex: /\)/,
                        next: "pop"
                    }, {
                        include: "#function_name"
                    }, {
                        include: "#function_arguments"
                    }, {
                        defaultToken: "meta.function-call.gdscript"
                    }],
                comment: "Regular function call of the type \"name(args)\" — allows optional whitespace between name and parens"
            }],
        "#function_name": [{
                include: "#builtin_classes"
            }, {
                token: "keyword.language.gdscript",
                regex: /\bpreload\b/
            }, {
                token: "entity.name.function.gdscript",
                regex: /\b[a-zA-Z_]\w*\b/,
                comment: "Some color schemas support meta.function-call.generic scope"
            }],
        "#function_arguments": [{
                token: "paren.lparen",
                regex: /\(/,
                push: [{
                        token: "text",
                        regex: /(?=\))(?!\)\s*\()/,
                        next: "pop"
                    }, {
                        token: "punctuation.separator.arguments.gdscript",
                        regex: /,/
                    }, {
                        token: [
                            "variable.parameter.function-call.gdscript",
                            "text",
                            "keyword.operator.assignment.gdscript"
                        ],
                        regex: /\b([a-zA-Z_]\w*)(\s*)(=)(?!=)/
                    }, {
                        token: "keyword.operator.assignment.gdscript",
                        regex: /=(?!=)/
                    }, {
                        include: "#base_expression"
                    }, {
                        token: [
                            "text",
                            "paren.rparen",
                            "text",
                            "paren.lparen"
                        ],
                        regex: /(\s*)(\))(\s*)(\()/
                    }, {
                        include: "#letter"
                    }, {
                        include: "#any_variable"
                    }, {
                        include: "#any_property"
                    }, {
                        include: "#keywords"
                    }, {
                        defaultToken: "meta.function.parameters.gdscript"
                    }]
            }]
    };
    this.normalizeRules();
};
oop.inherits(GDScriptHighlightRules, TextHighlightRules);
exports.GDScriptHighlightRules = GDScriptHighlightRules;

});

define("ace/mode/gdshader_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var GDShaderHighlightRules = function () {
    this.$rules = {
        start: [{
                include: "#any"
            }],
        "#any": [{
                include: "#comment"
            }, {
                include: "#preprocessorInclude"
            }, {
                include: "#hintEnum"
            }, {
                include: "#enclosed"
            }, {
                include: "#classifier"
            }, {
                include: "#definition"
            }, {
                include: "#keyword"
            }, {
                include: "#element"
            }, {
                include: "#separator"
            }, {
                include: "#operator"
            }],
        "#comment": [{
                include: "#commentLine"
            }, {
                include: "#commentBlock"
            }],
        "#commentLine": [{
                token: "comment",
                regex: /\/\//,
                push: [{
                        token: "comment",
                        regex: /$/,
                        next: "pop"
                    }, {
                        defaultToken: "comment"
                    }]
            }],
        "#commentBlock": [{
                token: "comment",
                regex: /\/\*/,
                push: [{
                        token: "comment",
                        regex: /\*\//,
                        next: "pop"
                    }, {
                        defaultToken: "comment"
                    }]
            }],
        "#preprocessorInclude": [{
                token: [
                    "keyword.control.directive.gdshader",
                    "text",
                    "string"
                ],
                regex: /(#[ \t]*include)([ \t]+)("[^"\r\n]*")/
            }],
        "#hintEnum": [{
                token: [
                    "support.type.annotation.gdshader",
                    "text",
                    "paren.lparen"
                ],
                regex: /(\bhint_enum\b)(\s*)(\()/,
                push: [{
                        token: "paren.rparen",
                        regex: /\)/,
                        next: "pop"
                    }, {
                        token: "string",
                        regex: /"[^"\r\n]*"/
                    }, {
                        include: "#comment"
                    }, {
                        include: "#separatorComma"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#enclosed": [{
                token: "paren.lparen",
                regex: /\(/,
                push: [{
                        token: "paren.rparen",
                        regex: /\)/,
                        next: "pop"
                    }, {
                        include: "#any"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#classifier": [{
                token: "meta.classifier.gdshader",
                regex: /(?=\b(?:shader_type|render_mode)\b)/,
                push: [{
                        token: "meta.classifier.gdshader",
                        regex: /(?<=;)/,
                        next: "pop"
                    }, {
                        include: "#comment"
                    }, {
                        include: "#keyword"
                    }, {
                        include: "#identifierClassification"
                    }, {
                        include: "#separator"
                    }, {
                        defaultToken: "meta.classifier.gdshader"
                    }]
            }],
        "#classifierKeyword": [{
                token: "keyword.language.classifier.gdshader",
                regex: /\b(?:shader_type|render_mode)\b/
            }],
        "#identifierClassification": [{
                token: "entity.other.inherited-class.gdshader",
                regex: /\b[a-z_]+\b/
            }],
        "#definition": [{
                include: "#structDefinition"
            }],
        "#arraySize": [{
                token: "paren.lparen",
                regex: /\[/,
                push: [{
                        token: "paren.rparen",
                        regex: /\]/,
                        next: "pop"
                    }, {
                        include: "#comment"
                    }, {
                        include: "#keyword"
                    }, {
                        include: "#element"
                    }, {
                        include: "#separator"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#structDefinition": [{
                token: "text",
                regex: /(?=\bstruct\b)/,
                push: [{
                        token: "text",
                        regex: /(?<=;)/,
                        next: "pop"
                    }, {
                        include: "#comment"
                    }, {
                        include: "#keyword"
                    }, {
                        include: "#structName"
                    }, {
                        include: "#structDefinitionBlock"
                    }, {
                        include: "#separator"
                    }]
            }],
        "#structKeyword": [{
                token: "keyword.other.struct.gdshader",
                regex: /\bstruct\b/
            }],
        "#structName": [{
                token: "entity.name.type.struct.gdshader",
                regex: /\b[a-zA-Z_]\w*\b/
            }],
        "#structDefinitionBlock": [{
                token: "paren.lparen",
                regex: /\{/,
                push: [{
                        token: "paren.rparen",
                        regex: /\}/,
                        next: "pop"
                    }, {
                        include: "#comment"
                    }, {
                        include: "#precisionKeyword"
                    }, {
                        include: "#fieldDefinition"
                    }, {
                        include: "#keyword"
                    }, {
                        include: "#any"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#fieldDefinition": [{
                token: [
                    "support.type.gdshader",
                    "entity.name.type.gdshader"
                ],
                regex: /\b(?:(void|bool|[biu]?vec[234]|u?int|float|mat[234]|[iu]?sampler(?:3D|2D(?:Array)?)|samplerCube)|([a-zA-Z_]\w*))\b/,
                push: [{
                        token: "meta.definition.field.gdshader",
                        regex: /(?<=;)/,
                        next: "pop"
                    }, {
                        include: "#comment"
                    }, {
                        include: "#keyword"
                    }, {
                        include: "#arraySize"
                    }, {
                        include: "#fieldName"
                    }, {
                        include: "#any"
                    }, {
                        defaultToken: "text"
                    }]
            }],
        "#fieldName": [{
                token: "entity.name.variable.field.gdshader",
                regex: /\b[a-zA-Z_]\w*\b/
            }],
        "#keyword": [{
                include: "#classifierKeyword"
            }, {
                include: "#structKeyword"
            }, {
                include: "#controlKeyword"
            }, {
                include: "#modifierKeyword"
            }, {
                include: "#precisionKeyword"
            }, {
                include: "#typeKeyword"
            }, {
                include: "#hintKeyword"
            }],
        "#controlKeyword": [{
                token: "keyword.control.gdshader",
                regex: /\b(?:if|else|do|while|for|continue|break|switch|case|default|return|discard)\b/
            }],
        "#modifierKeyword": [{
                token: "storage.modifier.gdshader",
                regex: /\b(?:const|global|instance|uniform|varying|in|out|inout|flat|smooth)\b/
            }],
        "#precisionKeyword": [{
                token: "storage.type.built-in.primitive.precision.gdshader",
                regex: /\b(?:low|medium|high)p\b/
            }],
        "#typeKeyword": [{
                token: "support.type.gdshader",
                regex: /\b(?:void|bool|[biu]?vec[234]|u?int|float|mat[234]|[iu]?sampler(?:3D|2D(?:Array)?)|samplerCube)\b/
            }],
        "#hintKeyword": [{
                token: "support.type.annotation.gdshader",
                regex: /\b(?:source_color|hint_(?:color|range|(?:black_)?albedo|normal|(?:default_)?(?:white|black)|aniso|anisotropy|roughness_(?:[rgba]|normal|gray))|filter_(?:nearest|linear)(?:_mipmap(?:_anisotropic)?)?|repeat_(?:en|dis)able)\b/
            }],
        "#element": [{
                include: "#literalFloat"
            }, {
                include: "#literalInt"
            }, {
                include: "#literalBool"
            }, {
                include: "#identifierType"
            }, {
                include: "#constructor"
            }, {
                include: "#processorFunction"
            }, {
                include: "#identifierFunction"
            }, {
                include: "#swizzling"
            }, {
                include: "#identifierField"
            }, {
                include: "#constantFloat"
            }, {
                include: "#languageVariable"
            }, {
                include: "#identifierVariable"
            }],
        "#literalFloat": [{
                token: "constant.numeric.float.gdshader",
                regex: /\b(?:\d+[eE][-+]?\d+|(?:\d*[.]\d+|\d+[.])(?:[eE][-+]?\d+)?)[fF]?/
            }],
        "#literalInt": [{
                token: "constant.numeric.integer.gdshader",
                regex: /\b(?:0[xX][0-9A-Fa-f]+|\d+[uU]?)\b/
            }],
        "#literalBool": [{
                token: "constant.language.boolean.gdshader",
                regex: /\b(?:false|true)\b/
            }],
        "#identifierType": [{
                token: "entity.name.type.gdshader",
                regex: /\b[a-zA-Z_]\w*(?=(?:\s*\[\s*\w*\s*\])?\s+[a-zA-Z_]\w*\b)/
            }],
        "#constructor": [{
                token: "entity.name.type.constructor.gdshader",
                regex: /\b[a-zA-Z_]\w*(?=\s*\[\s*\w*\s*\]\s*[(])|\b[A-Z]\w*(?=\s*[(])/
            }],
        "#processorFunction": [{
                token: "support.function.gdshader",
                regex: /\b(?:vertex|fragment|light|start|process|sky|fog)(?=(?:\s|\/\*(?:\*(?!\/)|[^*])*\*\/)*[(])/
            }],
        "#identifierFunction": [{
                token: "entity.name.function.gdshader",
                regex: /\b[a-zA-Z_]\w*(?=(?:\s|\/\*(?:\*(?!\/)|[^*])*\*\/)*[(])/
            }],
        "#swizzling": [{
                token: [
                    "punctuation.accessor.gdshader",
                    "text",
                    "variable.other.property.gdshader"
                ],
                regex: /([.])(\s*)([xyzw]{2,4}|[rgba]{2,4}|[stpq]{2,4})\b/
            }],
        "#identifierField": [{
                token: [
                    "punctuation.accessor.gdshader",
                    "text",
                    "entity.name.variable.field.gdshader"
                ],
                regex: /([.])(\s*)([a-zA-Z_]\w*)\b(?!\s*\()/
            }],
        "#constantFloat": [{
                token: "constant.language.float.gdshader",
                regex: /\b(?:E|PI|TAU)\b/
            }],
        "#languageVariable": [{
                token: "variable.language.gdshader",
                regex: /\b[A-Z][A-Z_0-9]*\b/
            }],
        "#identifierVariable": [{
                token: "variable.name.gdshader",
                regex: /\b[a-zA-Z_]\w*\b/
            }],
        "#separator": [{
                token: "punctuation.accessor.gdshader",
                regex: /[.]/
            }, {
                include: "#separatorComma"
            }, {
                token: "punctuation.terminator.statement.gdshader",
                regex: /[;]/
            }, {
                token: "keyword.operator.type.annotation.gdshader",
                regex: /[:]/
            }],
        "#separatorComma": [{
                token: "punctuation.separator.comma.gdshader",
                regex: /[,]/
            }],
        "#operator": [{
                token: "keyword.operator.gdshader",
                regex: /\<\<\=?|\>\>\=?|[-+*\/&|<>=!]\=|\&\&|[|][|]|[-+~!*\/%<>&^|=]/
            }]
    };
    this.normalizeRules();
};
oop.inherits(GDShaderHighlightRules, TextHighlightRules);
exports.GDShaderHighlightRules = GDShaderHighlightRules;

});

define("ace/mode/gdresource_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules","ace/mode/gdscript_highlight_rules","ace/mode/gdshader_highlight_rules"], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var GDScriptHighlightRules = require("./gdscript_highlight_rules").GDScriptHighlightRules;
var GDShaderHighlightRules = require("./gdshader_highlight_rules").GDShaderHighlightRules;
var GDResourceHighlightRules = function () {
    this.$rules = {
        start: [{
                include: "#embedded_shader"
            }, {
                include: "#embedded_gdscript"
            }, {
                include: "#comment"
            }, {
                include: "#heading"
            }, {
                include: "#key_value"
            }],
        "#comment": [{
                token: [
                    "punctuation.definition.comment.gdresource",
                    "comment"
                ],
                regex: /(;)(.*$)/
            }],
        "#embedded_shader": [{
                token: ["text", "variable.other.property.gdresource", "text"],
                regex: /(\s*)(code)(\s*=\s*")/,
                push: "gdshader-start"
            }],
        "#embedded_gdscript": [{
                token: ["text", "variable.other.property.gdresource", "text"],
                regex: /(\s*)(script\/source)(\s*=\s*")/,
                push: "gdscript-start"
            }],
        "#heading": [{
                token: ["paren.lparen", "keyword.control.gdresource"],
                regex: /(\[)([a-z_]*)/,
                push: [{
                        token: "paren.rparen",
                        regex: /\]/,
                        next: "pop"
                    }, {
                        include: "#heading_properties"
                    }, {
                        include: "#data"
                    }]
            }],
        "#heading_properties": [{
                token: "invalid.illegal.noValue.gdresource",
                regex: /\s*[A-Za-z_\-][A-Za-z0-9_\-]*\s*=(?=\s*$)/
            }, {
                token: [
                    "text",
                    "variable.other.property.gdresource",
                    "text",
                    "punctuation.definition.keyValue.gdresource",
                    "text"
                ],
                regex: /(\s*)([A-Za-z_-][^\s]*|".+"|'.+'|[0-9]+)(\s*)(=)(\s*)/,
                push: [{
                        token: "text",
                        regex: /^/,
                        next: "pop"
                    }, {
                        token: "text",
                        regex: /$|(?==)|\,?|\s*(?=\})/,
                        next: "pop"
                    }, {
                        include: "#data"
                    }]
            }],
        "#key_value": [{
                token: "invalid.illegal.noValue.gdresource",
                regex: /\s*[A-Za-z_\-][A-Za-z0-9_\-]*\s*=(?=\s*$)/
            }, {
                token: [
                    "text",
                    "variable.other.property.gdresource",
                    "text",
                    "punctuation.definition.keyValue.gdresource",
                    "text"
                ],
                regex: /(\s*)([A-Za-z_-][^\s]*|".+"|'.+'|[0-9]+)(\s*)(=)(\s*)/,
                push: [{
                        token: "text",
                        regex: /^/,
                        next: "pop"
                    }, {
                        token: "text",
                        regex: /$|(?==)|\,|\s*(?=\})/,
                        next: "pop"
                    }, {
                        include: "#data"
                    }]
            }],
        "#data": [{
                include: "#comment"
            }, {
                token: [
                    "paren.lparen",
                    "text"
                ],
                regex: /(?<!\w)(\{)(\s*)/,
                push: [{
                        token: [
                            "text",
                            "paren.rparen"
                        ],
                        regex: /(\s*)(\})(?!\w)/,
                        next: "pop"
                    }, {
                        include: "#key_value"
                    }, {
                        include: "#data"
                    }]
            }, {
                token: [
                    "paren.lparen",
                    "text"
                ],
                regex: /(?<!\w)(\[)(\s*)/,
                push: [{
                        token: [
                            "text",
                            "paren.rparen"
                        ],
                        regex: /(\s*)(\])(?!\w)/,
                        next: "pop"
                    }, {
                        include: "#data"
                    }]
            }, {
                token: "string",
                regex: /"""/,
                push: [{
                        token: "string",
                        regex: /"""/,
                        next: "pop"
                    }, {
                        token: "constant.character.escape.gdresource",
                        regex: /\\(?:[btnfr"\\$\/ ]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/
                    }, {
                        token: "invalid.illegal.escape.gdresource",
                        regex: /\\[^btnfr\/"\\$]/
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: "support.function.any-method.gdresource",
                regex: /"res:\/\/[^"\\]*(?:\\.[^"\\]*)*"/
            }, {
                token: "support.class.library.gdresource",
                regex: /(?<=type=)"[^"\\]*(?:\\.[^"\\]*)*"/
            }, {
                token: "constant.character.escape.gdresource",
                regex: /(?<=NodePath\(|parent=|name=)"[^"\\]*(?:\\.[^"\\]*)*"/
            }, {
                token: "string",
                regex: /"/,
                push: [{
                        token: "string",
                        regex: /"/,
                        next: "pop"
                    }, {
                        token: "constant.character.escape.gdresource",
                        regex: /\\(?:[btnfr"\\$\/ ]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/
                    }, {
                        token: "invalid.illegal.escape.gdresource",
                        regex: /\\[^btnfr\/"\\$]/
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: "string",
                regex: /'.*?'/
            }, {
                token: "constant.language.gdresource",
                regex: /(?<!\w)(?:true|false)(?!\w)/
            }, {
                token: "constant.numeric.float.gdresource",
                regex: /(?<!\w)[\+\-]?(?:0|[1-9](?:(?:[0-9]|_[0-9])+)?)(?:(?:\.(?:0|[1-9](?:(?:[0-9]|_[0-9])+)?))?[eE][\+\-]?[1-9]_?[0-9]*|\.[0-9_]*)(?!\w)/
            }, {
                token: "constant.numeric.integer.gdresource",
                regex: /(?<!\w)[\+\-]?(?:0|[1-9](?:(?:[0-9]|_[0-9])+)?)(?!\w)/
            }, {
                token: "constant.numeric.inf.gdresource",
                regex: /(?<!\w)[\+\-]?inf(?!\w)/
            }, {
                token: "constant.numeric.nan.gdresource",
                regex: /(?<!\w)[\+\-]?nan(?!\w)/
            }, {
                token: "constant.numeric.hex.gdresource",
                regex: /(?<!\w)0x[0-9a-fA-F](?:(?:[0-9a-fA-F]|_[0-9a-fA-F])+)?(?!\w)/
            }, {
                token: "constant.numeric.oct.gdresource",
                regex: /(?<!\w)0o[0-7](?:_?[0-7])*(?!\w)/
            }, {
                token: "constant.numeric.bin.gdresource",
                regex: /(?<!\w)0b[01](?:_?[01])*(?!\w)/
            }, {
                token: [
                    "support.class.library.gdresource",
                    "paren.lparen",
                    "text"
                ],
                regex: /(?<!\w)(Vector2|Vector2i|Vector3|Vector3i|Color|Rect2|Rect2i|Array|Basis|Dictionary|Plane|Quat|RID|Rect3|Transform|Transform2D|Transform3D|AABB|String|Color|NodePath|Object|PoolByteArray|PoolIntArray|PoolRealArray|PoolStringArray|PoolVector2Array|PoolVector3Array|PoolColorArray|bool|int|float|StringName|Quaternion|PackedByteArray|PackedInt32Array|PackedInt64Array|PackedFloat32Array|PackedFloat64Array|PackedStringArray|PackedVector2Array|PackedVector2iArray|PackedVector3Array|PackedVector3iArray|PackedColorArray)(\()(\s?)/,
                push: [{
                        token: "paren.rparen",
                        regex: /\s?\)/,
                        next: "pop"
                    }, {
                        include: "#key_value"
                    }, {
                        include: "#data"
                    }]
            }, {
                token: ["keyword.control.gdresource", "paren.lparen", "text"],
                regex: /(?<!\w)(ExtResource|SubResource)(\()(\s?)/,
                push: [{
                        token: "paren.rparen",
                        regex: /\s?\)/,
                        next: "pop"
                    }, {
                        include: "#key_value"
                    }, {
                        include: "#data"
                    }]
            }]
    };
    var gdshaderRules = new GDShaderHighlightRules().getRules();
    var shaderIncludePattern = /(#[ \t]*include)([ \t]+)("[^"\r\n]*")/.source;
    var shaderHintStringPattern = /"[^"\r\n]*"/.source;
    Object.keys(gdshaderRules).forEach(function (stateName) {
        gdshaderRules[stateName].forEach(function (rule) {
            var pattern = rule.regex && rule.regex.source;
            if (pattern === shaderIncludePattern) {
                rule.regex = /(#[ \t]*include)([ \t]+)(\\"[^"\r\n]*\\")/;
            }
            else if (pattern === shaderHintStringPattern) {
                rule.regex = /\\"[^"\r\n]*\\"/;
            }
        });
    });
    var endEmbeddedShader = function (currentState, stack) {
        stack.length = 0;
        return "start";
    };
    this.embedRules(gdshaderRules, "gdshader-", [{
            token: "text",
            regex: /(?<!\\)"/,
            next: endEmbeddedShader
        }]);
    var gdscriptRules = new GDScriptHighlightRules().getRules();
    var doubleQuotePattern = /((?:r)?)(")/.source;
    var tripleDoubleQuotePattern = /((?:r)?)(""")/.source;
    var doubleQuoteAtEolPattern = /"(?=$)/.source;
    var tripleDoubleQuoteAtEolPattern = /"""(?=$)/.source;
    var encodedDoubleStringStates = Object.create(null);
    var gdscriptEolStates = {
        "gdscript-signal_declaration": true,
        "gdscript-lambda_declaration": true,
        "gdscript-function_declaration": true,
        "gdscript-variable_declaration": true
    };
    var popEscapedStringAtEol = function (currentState, stack) {
        stack.shift();
        var parent = stack.shift() || "start";
        while (gdscriptEolStates[parent]) {
            stack.shift();
            parent = stack.shift() || "start";
        }
        return parent;
    };
    Object.keys(gdscriptRules).forEach(function (stateName) {
        var rules = gdscriptRules[stateName];
        for (var i = rules.length - 1; i >= 0; i--) {
            var rule = rules[i];
            var pattern = rule.regex && rule.regex.source;
            if (pattern === tripleDoubleQuotePattern) {
                rule.regex = /((?:r)?)((?:\\"){3})/;
                encodedDoubleStringStates[rule.nextState] = true;
            }
            else if (pattern === doubleQuotePattern || pattern === "\"" && rule.nextState) {
                rule.regex = pattern === doubleQuotePattern
                    ? /((?:r)?)(\\")/
                    : /\\"/;
                encodedDoubleStringStates[rule.nextState] = false;
            }
        }
    });
    Object.keys(encodedDoubleStringStates).forEach(function (stateName) {
        var isTripleQuoted = encodedDoubleStringStates[stateName];
        var rules = gdscriptRules[stateName];
        var hasEscapeRule = false;
        rules.forEach(function (rule) {
            var pattern = rule.regex && rule.regex.source;
            if (pattern === (isTripleQuoted ? tripleDoubleQuoteAtEolPattern : doubleQuoteAtEolPattern)) {
                rule.regex = isTripleQuoted ? /(?:\\"){3}(?=$)/ : /\\"(?=$)/;
                rule.next = popEscapedStringAtEol;
            }
            else if (pattern === (isTripleQuoted ? tripleDoubleQuotePattern : "\"")) {
                rule.regex = isTripleQuoted ? /(?:\\"){3}/ : /\\"/;
            }
            else if (pattern === /\\./.source) {
                rule.regex = /\\\\(?:\\\\|\\"|.)/;
                hasEscapeRule = true;
            }
        });
        if (!hasEscapeRule) {
            rules.splice(rules.length - 1, 0, {
                token: "constant.character.escape.gdscript",
                regex: /\\\\(?:\\\\|\\"|.)/
            });
        }
    });
    this.embedRules(gdscriptRules, "gdscript-", [{
            token: "text",
            regex: /"/,
            next: "pop"
        }], ["start"]);
    this.normalizeRules();
};
oop.inherits(GDResourceHighlightRules, TextHighlightRules);
exports.GDResourceHighlightRules = GDResourceHighlightRules;

});

define("ace/mode/folding/cstyle",["require","exports","module","ace/lib/oop","ace/range","ace/mode/folding/fold_mode"], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var Range = require("../../range").Range;
var BaseFoldMode = require("./fold_mode").FoldMode;
var FoldMode = exports.FoldMode = function (commentRegex) {
    if (commentRegex) {
        this.foldingStartMarker = new RegExp(this.foldingStartMarker.source.replace(/\|[^|]*?$/, "|" + commentRegex.start));
        this.foldingStopMarker = new RegExp(this.foldingStopMarker.source.replace(/\|[^|]*?$/, "|" + commentRegex.end));
    }
};
oop.inherits(FoldMode, BaseFoldMode);
(function () {
    this.foldingStartMarker = /([\{\[\(])[^\}\]\)]*$|^\s*(\/\*)/;
    this.foldingStopMarker = /^[^\[\{\(]*([\}\]\)])|^[\s\*]*(\*\/)/;
    this.singleLineBlockCommentRe = /^\s*(\/\*).*\*\/\s*$/;
    this.tripleStarBlockCommentRe = /^\s*(\/\*\*\*).*\*\/\s*$/;
    this.startRegionRe = /^\s*(\/\*|\/\/)#?region\b/;
    this._getFoldWidgetBase = this.getFoldWidget;
    this.getFoldWidget = function (session, foldStyle, row) {
        var line = session.getLine(row);
        if (this.singleLineBlockCommentRe.test(line)) {
            if (!this.startRegionRe.test(line) && !this.tripleStarBlockCommentRe.test(line))
                return "";
        }
        var fw = this._getFoldWidgetBase(session, foldStyle, row);
        if (!fw && this.startRegionRe.test(line))
            return "start"; // lineCommentRegionStart
        return fw;
    };
    this.getFoldWidgetRange = function (session, foldStyle, row, forceMultiline) {
        var line = session.getLine(row);
        if (this.startRegionRe.test(line))
            return this.getCommentRegionBlock(session, line, row);
        var match = line.match(this.foldingStartMarker);
        if (match) {
            var i = match.index;
            if (match[1])
                return this.openingBracketBlock(session, match[1], row, i);
            var range = session.getCommentFoldRange(row, i + match[0].length, 1);
            if (range && !range.isMultiLine()) {
                if (forceMultiline) {
                    range = this.getSectionRange(session, row);
                }
                else if (foldStyle != "all")
                    range = null;
            }
            return range;
        }
        if (foldStyle === "markbegin")
            return;
        var match = line.match(this.foldingStopMarker);
        if (match) {
            var i = match.index + match[0].length;
            if (match[1])
                return this.closingBracketBlock(session, match[1], row, i);
            return session.getCommentFoldRange(row, i, -1);
        }
    };
    this.getSectionRange = function (session, row) {
        var line = session.getLine(row);
        var startIndent = line.search(/\S/);
        var startRow = row;
        var startColumn = line.length;
        row = row + 1;
        var endRow = row;
        var maxRow = session.getLength();
        while (++row < maxRow) {
            line = session.getLine(row);
            var indent = line.search(/\S/);
            if (indent === -1)
                continue;
            if (startIndent > indent)
                break;
            var subRange = this.getFoldWidgetRange(session, "all", row);
            if (subRange) {
                if (subRange.start.row <= startRow) {
                    break;
                }
                else if (subRange.isMultiLine()) {
                    row = subRange.end.row;
                }
                else if (startIndent == indent) {
                    break;
                }
            }
            endRow = row;
        }
        return new Range(startRow, startColumn, endRow, session.getLine(endRow).length);
    };
    this.getCommentRegionBlock = function (session, line, row) {
        var startColumn = line.search(/\s*$/);
        var maxRow = session.getLength();
        var startRow = row;
        var re = /^\s*(?:\/\*|\/\/|--)#?(end)?region\b/;
        var depth = 1;
        while (++row < maxRow) {
            line = session.getLine(row);
            var m = re.exec(line);
            if (!m)
                continue;
            if (m[1])
                depth--;
            else
                depth++;
            if (!depth)
                break;
        }
        var endRow = row;
        if (endRow > startRow) {
            return new Range(startRow, startColumn, endRow, line.length);
        }
    };
}).call(FoldMode.prototype);

});

define("ace/mode/gdresource",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/gdresource_highlight_rules","ace/mode/folding/cstyle"], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var GDResourceHighlightRules = require("./gdresource_highlight_rules").GDResourceHighlightRules;
var FoldMode = require("./folding/cstyle").FoldMode;
var Mode = function () {
    this.HighlightRules = GDResourceHighlightRules;
    this.foldingRules = new FoldMode();
};
oop.inherits(Mode, TextMode);
(function () {
    this.lineCommentStart = ";";
    this.$id = "ace/mode/gdresource";
}).call(Mode.prototype);
exports.Mode = Mode;

});                (function() {
                    window.require(["ace/mode/gdresource"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            