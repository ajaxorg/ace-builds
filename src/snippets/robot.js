define("ace/snippets/robot",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.snippetText = "# scope: robot\n\
### Sections\n\
snippet settingssection\n\
description *** Settings *** section\n\
	*** Settings ***\n\
	Library    ${1}\n\
\n\
snippet keywordssection\n\
description *** Keywords *** section\n\
	*** Keywords ***\n\
	${1:Keyword Name}\n\
	    [Arguments]    \\${${2:Example Arg 1}}\n\
	\n\
snippet testcasessection\n\
description *** Test Cases *** section\n\
	*** Test Cases ***\n\
	${1:First Test Case}\n\
	    ${2:Log    Example Arg}\n\
\n\
snippet variablessection\n\
description *** Variables *** section\n\
	*** Variables ***\n\
	\\${${1:Variable Name}}=    ${2:Variable Value}\n\
\n\
### Helpful keywords\n\
snippet testcase\n\
description A test case\n\
	${1:Test Case Name}\n\
	    ${2:Log    Example log message}\n\
	\n\
snippet keyword\n\
description A keyword\n\
	${1:Example Keyword}\n\
	    [Arguments]    \\${${2:Example Arg 1}}\n\
\n\
### Built Ins\n\
snippet forinr\n\
description For In Range Loop\n\
	FOR    \\${${1:Index}}    IN RANGE     \\${${2:10}}\n\
	    Log     \\${${1:Index}}\n\
	END\n\
\n\
snippet forin\n\
description For In Loop\n\
	FOR    \\${${1:Item}}    IN     @{${2:List Variable}}\n\
	    Log     \\${${1:Item}}\n\
	END\n\
\n\
snippet if\n\
description If Statement\n\
	IF    ${1:condition}\n\
	    ${2:Do something}\n\
	END\n\
\n\
snippet else\n\
description If Statement\n\
	IF    ${1:Condition}\n\
	    ${2:Do something}\n\
	ELSE\n\
	    ${3:Otherwise do this}\n\
	END\n\
\n\
snippet elif\n\
description Else-If Statement\n\
	IF    ${1:Condition 1}\n\
	    ${2:Do something}\n\
	ELSE IF    ${3:Condition 2}\n\
	    ${4:Do something else}\n\
	END\n\
";
exports.scope = "robot";

});                (function() {
                    window.require(["ace/snippets/robot"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            