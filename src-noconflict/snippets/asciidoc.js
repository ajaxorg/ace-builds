ace.define("ace/snippets/asciidoc",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "asciidoc";

});
                (function() {
                    ace.require(["ace/snippets/asciidoc"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            