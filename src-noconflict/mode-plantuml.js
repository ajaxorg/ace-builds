/**
 * based on
 * " Vim PlantUML syntax file
 * "    Language: PlantUML2
 * "    Revision: 0.1
 * "  Maintainer: Manuel López <nicamlg@gmail.com>
 * " Last Change: 2014-11-12
 **/
ace.define(
    "ace/mode/plantuml",
    ["require","exports","module","ace/lib/oop","ace/mode/text","ace/tokenizer","ace/mode/plantuml","ace/range"],
    function(e,t,n) {
        var r=e("../lib/oop"),
            i=e("./text").Mode,
            s=e("../tokenizer").Tokenizer,
            o=e("./plantuml_highlight_rules").PlantumlHighlightRules,
            u=function() {
                this.HighlightRules=o;
            };
        r.inherits(u,i),t.Mode=u
    }),
ace.define(
    "ace/mode/plantuml_highlight_rules",
    ["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"],
    function(e, t, n) {
        var r = e("../lib/oop"),
            i = e("./text_highlight_rules").TextHighlightRules,
            s = function() {

            var lang  = "!(:?include|ifdef|define|endif)";
                lang += "|page|top\sto\sbottom|direction|left\sto\sright|width|height";
                lang += "|center|scale|autonumber|skinparam|hide\\sfootbox";
            var docBlocks = "|title|header|end\\s?header|legend|endlegend|newpage|footer|end\\s?footer";

            // skinparam keywords
            var skinKeywords = "|activityArrowColor|activityArrowFontColor|activityArrowFontName";
                skinKeywords+= "|activityArrowFontSize|activityArrowFontStyle|activityBackgroundColor";
                skinKeywords+= "|activityBarColor|activityBorderColor|activityEndColor|activityFontColor";
                skinKeywords+= "|activityFontName|activityFontSize|activityFontStyle|activityStartColor";
                skinKeywords+= "|backgroundColor|circledCharacterFontColor|circledCharacterFontName";
                skinKeywords+= "|circledCharacterFontSize|circledCharacterFontStyle|circledCharacterRadius";
                skinKeywords+= "|classArrowColor|classArrowFontColor|classArrowFontName|classArrowFontSize";
                skinKeywords+= "|classArrowFontStyle|classAttributeFontColor|classAttributeFontName";
                skinKeywords+= "|classAttributeFontSize|classAttributeFontStyle|classAttributeIconSize";
                skinKeywords+= "|classBackgroundColor|classBorderColor|classFontColor|classFontName";
                skinKeywords+= "|classFontSize|classFontStyle|classStereotypeFontColor|classStereotypeFontName";
                skinKeywords+= "|classStereotypeFontSize|classStereotypeFontStyle|componentArrowColor";
                skinKeywords+= "|componentArrowFontColor|componentArrowFontName|componentArrowFontSize";
                skinKeywords+= "|componentArrowFontStyle|componentBackgroundColor|componentBorderColor";
                skinKeywords+= "|componentFontColor|componentFontName|componentFontSize|componentFontStyle";
                skinKeywords+= "|componentInterfaceBackgroundColor|componentInterfaceBorderColor";
                skinKeywords+= "|componentStereotypeFontColor|componentStereotypeFontName";
                skinKeywords+= "|componentStereotypeFontSize|componentStereotypeFontStyle|footerFontColor";
                skinKeywords+= "|footerFontName|footerFontSize|footerFontStyle|headerFontColor|headerFontName";
                skinKeywords+= "|headerFontSize|headerFontStyle|noteBackgroundColor|noteBorderColor";
                skinKeywords+= "|noteFontColor|noteFontName|noteFontSize|noteFontStyle|packageBackgroundColor";
                skinKeywords+= "|packageBorderColor|packageFontColor|packageFontName|packageFontSize";
                skinKeywords+= "|packageFontStyle|sequenceActorBackgroundColor|sequenceActorBorderColor";
                skinKeywords+= "|sequenceActorFontColor|sequenceActorFontName|sequenceActorFontSize";
                skinKeywords+= "|sequenceActorFontStyle|sequenceArrowColor|sequenceArrowFontColor";
                skinKeywords+= "|sequenceArrowFontName|sequenceArrowFontSize|sequenceArrowFontStyle";
                skinKeywords+= "|sequenceDividerBackgroundColor|sequenceDividerFontColor|sequenceDividerFontName";
                skinKeywords+= "|sequenceDividerFontSize|sequenceDividerFontStyle|sequenceGroupBackgroundColor";
                skinKeywords+= "|sequenceGroupingFontColor|sequenceGroupingFontName|sequenceGroupingFontSize";
                skinKeywords+= "|sequenceGroupingFontStyle|sequenceGroupingHeaderFontColor";
                skinKeywords+= "|sequenceGroupingHeaderFontName|sequenceGroupingHeaderFontSize";
                skinKeywords+= "|sequenceGroupingHeaderFontStyle|sequenceLifeLineBackgroundColor";
                skinKeywords+= "|sequenceLifeLineBorderColor|sequenceParticipantBackgroundColor";
                skinKeywords+= "|sequenceParticipantBorderColor|sequenceParticipantFontColor";
                skinKeywords+= "|sequenceParticipantFontName|sequenceParticipantFontSize";
                skinKeywords+= "|sequenceParticipantFontStyle|sequenceTitleFontColor|sequenceTitleFontName";
                skinKeywords+= "|sequenceTitleFontSize|sequenceTitleFontStyle|stateArrowColor";
                skinKeywords+= "|stateArrowFontColor|stateArrowFontName|stateArrowFontSize|stateArrowFontStyle";
                skinKeywords+= "|stateAttributeFontColor|stateAttributeFontName|stateAttributeFontSize";
                skinKeywords+= "|stateAttributeFontStyle|stateBackgroundColor|stateBorderColor|stateEndColor";
                skinKeywords+= "|stateFontColor|stateFontName|stateFontSize|stateFontStyle|stateStartColor";
                skinKeywords+= "|stereotypeABackgroundColor|stereotypeCBackgroundColor";
                skinKeywords+= "|stereotypeEBackgroundColor|stereotypeIBackgroundColor|titleFontColor";
                skinKeywords+= "|titleFontName|titleFontSize|titleFontStyle|usecaseActorBackgroundColor";
                skinKeywords+= "|usecaseActorBorderColor|usecaseActorFontColor|usecaseActorFontName";
                skinKeywords+= "|usecaseActorFontSize|usecaseActorFontStyle|usecaseActorStereotypeFontColor";
                skinKeywords+= "|usecaseActorStereotypeFontName|usecaseActorStereotypeFontSize";
                skinKeywords+= "|usecaseActorStereotypeFontStyle|usecaseArrowColor|usecaseArrowFontColor";
                skinKeywords+= "|usecaseArrowFontName|usecaseArrowFontSize|usecaseArrowFontStyle";
                skinKeywords+= "|usecaseBackgroundColor|usecaseBorderColor|usecaseFontColor|usecaseFontName";
                skinKeywords+= "|usecaseFontSize|usecaseFontStyle|usecaseStereotypeFontColor";
                skinKeywords+= "|usecaseStereotypeFontName|usecaseStereotypeFontSize|usecaseStereotypeFontStyle";
                skinKeywords+= "|ActorBackgroundColor|ActorBorderColor|ActorFontColor|ActorFontName";
                skinKeywords+= "|ActorFontSize|ActorFontStyle|ActorStereotypeFontColor|ActorStereotypeFontName";
                skinKeywords+= "|ActorStereotypeFontSize|ActorStereotypeFontStyle|ArrowColor|ArrowFontColor";
                skinKeywords+= "|ArrowFontName|ArrowFontSize|ArrowFontStyle|AttributeFontColor|AttributeFontName";
                skinKeywords+= "|AttributeFontSize|AttributeFontStyle|AttributeIconSize|BackgroundColor|BarColor";
                skinKeywords+= "|BorderColor|CharacterFontColor|CharacterFontName|CharacterFontSize";
                skinKeywords+= "|CharacterFontStyle|CharacterRadius|Color|DividerBackgroundColor";
                skinKeywords+= "|DividerFontColor|DividerFontName|DividerFontSize|DividerFontStyle|EndColor";
                skinKeywords+= "|FontColor|FontName|FontSize|FontStyle|GroupBackgroundColor|GroupingFontColor";
                skinKeywords+= "|GroupingFontName|GroupingFontSize|GroupingFontStyle|GroupingHeaderFontColor";
                skinKeywords+= "|GroupingHeaderFontName|GroupingHeaderFontSize|GroupingHeaderFontStyle";
                skinKeywords+= "|InterfaceBackgroundColor|InterfaceBorderColor|LifeLineBackgroundColor";
                skinKeywords+= "|LifeLineBorderColor|ParticipantBackgroundColor|ParticipantBorderColor";
                skinKeywords+= "|ParticipantFontColor|ParticipantFontName|ParticipantFontSize";
                skinKeywords+= "|ParticipantFontStyle|StartColor|stateArrowColor|stereotypeABackgroundColor";
                skinKeywords+= "|stereotypeCBackgroundColor|stereotypeEBackgroundColor|StereotypeFontColor";
                skinKeywords+= "|StereotypeFontName|StereotypeFontSize|StereotypeFontStyle";
                skinKeywords+= "|stereotypeIBackgroundColor|TitleFontColor|TitleFontName|TitleFontSize|TitleFontStyle";

            var plantFunctions = "|actor|boundary|control|entity|database|participant"; // Sequence Diagram objects
                plantFunctions+= "|alt|else|loop|opt|lr|par|break|critical|group|box";     // Sequence Diagram grouping controls
                plantFunctions+= "|note|rnote|hnote|right|left|top|bottom|over|of|end"; // PlantUML2 notes
                plantFunctions+= "|activate|create|deactivate|destroy";                 // Sequence Diagram lifeline controls
                plantFunctions+= "|usecase|rectangle";                               // Use Case Diagram objects
                plantFunctions+= "|start|stop|if|then|else|endif|repeat|while|endwhile";// Activity Diagram controls
                plantFunctions+= "|fork|forkagain|endfork|partition|\\|Swimlane\\w+\\||detach";
                plantFunctions+= "|class|\\{(?:abstract|static|classifier)\\}";         // Class diagram objects and controls
                plantFunctions+= "|abstract|interface|annotation|enum|hide";
                plantFunctions+= "|hide empty (?:members|attributes|methods|circle|stereotype|fields)";
                plantFunctions+= "|show (?:members|attributes|methods|circle|stereotype|fields)";
                plantFunctions+= "|package(?:<<(?:Node|Rect|Folder|Frame|Cloud|Database)>>)?|";
                plantFunctions+= "|namespace|set\\snamespaceSeparator";
                plantFunctions+= "|package|node|folder|frame|cloud|database";           // Component Diagram group
                plantFunctions+= "|\\[\\*\\]|state";
                plantFunctions+= "|object";
                //plantFunctions+= "|";

            var constants = "right|left|up|down|over|of|as|is";

            var keywordMapper = this.createKeywordMapper({
                "storage.type":       lang,
                "variable.language":  docBlocks,
                "variable.parameter": skinKeywords,
                "keyword.function":   plantFunctions,
                "variable.other":     constants,
                "support.type":
                    "bool(?:ean)?|string|int(?:eger)?|float|double|(?:var)?char|" +
                    "decimal|date|time|timestamp|array|void|none",
                }, "text", true, "|"
            );

            this.$rules = {
                "start" : [
                    {token : "constant.language", regex: "@startuml|@enduml", next: "start"},
                    {token : keywordMapper, regex : "\\b\\w+\\b"},
                    {token : "string", regex : '"', next  : "string"},
                    {token : "string", regex : ': .*$', next  : "start"},
                    {token : "variable.language", regex : '[\\[(]\\*[)\\]]', next  : "start"},
                    {token : "variable.language", regex : '={2,}[^=]+={2,}', next  : "start"},
                    {token : "variable.language", regex : /(\|\|\|)/, next: "start"},
                    {token : ["variable.language","constant.numeric","variable.language"], regex : /(\|\|)(\d+)(\|\|)/, next: "start"},
                    {token : ["keyword","string","keyword"], regex: /(title)(.*)(end\s?title)?/, next: "start"},
                    {
                        token : ["keyword","variable.other","text"],
                        regex : /(title|legend|note|header|footer)(\sas|\sleft|\sright|\sup|\sbottom|\sover)?(?:\s*)(?:^:)([^:]+)?/,
                        next  : "string"
                    },
                    //<< (C,#ADD1B2) >>
                    {
                        token : ["variable.language","paren.lparen","string","constant.character","constant.other","paren.rparen","variable.language"],
                        regex : /(<<\s?)(\()(\w+)(,(:?#\d{3,6}|\w+))(\))(\s?>>)/,
                        next  : "start"
                    },
                    {token : "constant.other", regex : /(#(:?\w+|[0-9a-z]{3}|[0-9a-z]{6}))/, next: "start"},
                    {token : "keyword", regex : /^\s*:[^\/;|\}\{\n]+[\}\{;\\\|\/]$/mi},
                    {token : "doc.comment", regex : /^\s*'.+/},
                    {token : "keyword.operator", regex: /(:?[-\/o<]{1,2})?-(?:[-\/o>]{1,2})|(?:<\|--?-?(?:\|>)?)|(?:\.{1,3}\|?>)/},
                    {token : "constant.other", regex: "[:\\[({][^:\\[({]+[:\\])}]", next : "start"},
                    {token : "paren.lparen", regex : "[:\\[({]"},
                    {token : "paren.rparen", regex : "[:\\])}]"},
                    {caseInsensitive: true}
                ],
                "string" : [
                    {token : ["variable.language","keyword"], regex: /(end)(\s?\w+)$/, next: "start"},
                    {token : "constant.language.escape",  regex : "\\\\"},
                    {token : "string", regex : '"',     next  : "start"},
                    {defaultToken : "string"}
                ],
            };
        };
    r.inherits(s, i),
    t.PlantumlHighlightRules = s
    //(function() {
    //    this.lineCommentStart = "'";
    //    this.$id = "ace/mode/plantuml";
    //}).call(Mode.prototype);

    //t.Mode = Mode;
});
