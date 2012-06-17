/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      Fabian Jakobs <fabian AT ajax DOT org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

define('ace/theme/github', ['require', 'exports', 'module', 'ace/lib/dom'], function(require, exports, module) {

exports.isDark = true;
exports.cssClass = "ace-github";
exports.cssText = "/* CSS style content from github's default pygments highlighter template.\
   Cursor and selection styles from textmate.css. */\
.ace-github .ace_editor {\
  color: #333;\
  background-color: #F8F8F8;\
  border: 1px solid #CCC;\
  font: 13px 'Bitstream Vera Sans Mono', Courier, monospace !important;\
  line-height: 19px !important;\
  overflow: auto;\
  padding: 6px 10px;\
  border-radius: 3px;\
  position: relative;\
  margin-bottom: 15px;\
}\
\
.ace-github .ace_keyword {\
  font-weight: bold;\
}\
\
.ace-github .ace_string {\
  color: #D14;\
}\
\
.ace-github .ace_variable.ace_class {\
  color: teal;\
}\
\
.ace-github .ace_constant.ace_numeric {\
  color: #099;\
}\
\
.ace-github .ace_comment {\
  color: #998;\
  font-style: italic;\
}\
\
.ace-github .ace_variable.ace_language  {\
  color: #0086B3;\
}\
\
.ace-github .ace_paren.ace_lparen,\
.ace-github .ace_paren.ace_rparen {\
  font-weight: bold;\
}\
\
.ace-github .ace_constant.ace_language.ace_boolean {\
  font-weight: bold;\
}\
\
.ace-github .ace_string.ace_regexp {\
  color: #009926;\
  font-weight: normal;\
}\
\
.ace-github .ace_variable.ace_instancce {\
  color: teal;\
}\
\
.ace-github .ace_constant.ace_language {\
  font-weight: bold;\
}\
\
.ace-github .ace_text-layer {\
  cursor: text;\
}\
\
.ace-github .ace_cursor {\
  border-left: 2px solid black;\
}\
\
.ace-github .ace_cursor.ace_overwrite {\
  border-left: 0px;\
  border-bottom: 1px solid black;\
}\
\
.ace-github .ace_marker-layer .ace_selection {\
  background: rgb(181, 213, 255);\
}\
.ace-github.multiselect .ace_selection.start {\
  box-shadow: 0 0 3px 0px white;\
  border-radius: 2px;\
}";

    var dom = require("../lib/dom");
    dom.importCssString(exports.cssText, exports.cssClass);
});
