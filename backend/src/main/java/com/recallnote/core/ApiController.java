package com.recallnote.core;

import java.util.*;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1")
public class ApiController {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ApiController.class);
    static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();
    private final JdbcTemplate db;
    private final HttpClient agent = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
    private final String agentBaseUrl;
    private final String apiKey;
    public ApiController(JdbcTemplate db, @Value("${agent.base-url}") String baseUrl,
                         @Value("${agent.internal-api-key}") String apiKey,
                         @Value("${app.dev-user-id}") String ignoredDevUserId) {
        this.db=db; this.apiKey=apiKey; this.agentBaseUrl=baseUrl;
    }
    private String userId() { return CURRENT_USER.get(); }

    @PostMapping("/records") public ResponseEntity<Map<String,Object>> create(@RequestBody Map<String,Object> body) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO record(id,user_id,title,content_markdown,tags_json) VALUES (?,?,?,?,?::jsonb)",
                id,userId(), required(body,"title"), required(body,"contentMarkdown"), json(body.getOrDefault("tags",List.of())));
        return ResponseEntity.status(201).body(record(id));
    }
    @GetMapping("/records") public List<Map<String,Object>> records() {
        return db.queryForList("SELECT id,title,content_markdown AS \"contentMarkdown\",tags_json AS tags,version,created_at AS \"createdAt\" FROM record WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC",userId());
    }
    @GetMapping("/records/{id}") public Map<String,Object> get(@PathVariable UUID id) { return record(id); }
    @PutMapping("/records/{id}") public Map<String,Object> update(@PathVariable UUID id,@RequestBody Map<String,Object> b) {
        if(db.update("UPDATE record SET title=?,content_markdown=?,tags_json=?::jsonb,version=version+1,updated_at=now() WHERE id=? AND user_id=? AND deleted_at IS NULL", required(b,"title"),required(b,"contentMarkdown"),json(b.getOrDefault("tags",List.of())),id,userId())==0) throw new NotFoundException();
        return record(id);
    }
    @DeleteMapping("/records/{id}") public ResponseEntity<Void> delete(@PathVariable UUID id) {
        if(db.update("UPDATE record SET deleted_at=now() WHERE id=? AND user_id=? AND deleted_at IS NULL",id,userId())==0) throw new NotFoundException();
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/epics/active") public Map<String,Object> epic() {
        return activeEpic(useCase());
    }

    @GetMapping("/users/me/profile") public Map<String,Object> profile() {
        List<Map<String,Object>> rows=db.queryForList("SELECT display_name AS \"displayName\",COALESCE(occupation,'') AS occupation,current_goal AS \"currentGoal\",experience_summary AS \"experienceSummary\",interests_json::text AS interests,COALESCE(use_case,'CAREER') AS \"useCase\" FROM user_profile WHERE user_id=?",userId());
        if(rows.isEmpty()) return Map.of("displayName","","occupation","","currentGoal","","experienceSummary","","interests",List.of(),"useCase","CAREER");
        Map<String,Object> result=rows.get(0); result.put("onboardingCompleted",Boolean.TRUE.equals(db.queryForObject("SELECT onboarding_completed FROM user_profile WHERE user_id=?",Boolean.class,userId()))); result.put("interests",parseJsonArray(result.get("interests"))); return result;
    }
    @PutMapping("/users/me/profile") @Transactional public Map<String,Object> updateProfile(@RequestBody Map<String,Object> body) {
        String selectedUseCase=normalizedUseCase(body.get("useCase"));
        db.update("INSERT INTO user_profile(user_id,display_name,occupation,current_goal,experience_summary,interests_json,use_case) VALUES (?,?,?,?,?,?::jsonb,?) ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,occupation=EXCLUDED.occupation,current_goal=EXCLUDED.current_goal,experience_summary=EXCLUDED.experience_summary,interests_json=EXCLUDED.interests_json,use_case=EXCLUDED.use_case",
                userId(),Objects.toString(body.getOrDefault("displayName",""),"").trim(),Objects.toString(body.getOrDefault("occupation",""),"").trim(),Objects.toString(body.getOrDefault("currentGoal",""),"").trim(),Objects.toString(body.getOrDefault("experienceSummary",""),"").trim(),json(stringList(body.get("interests"))),selectedUseCase);
        db.update("UPDATE user_profile SET onboarding_completed=true WHERE user_id=?",userId());
        activeEpic(selectedUseCase);
        return profile();
    }

    @PostMapping("/agent-sessions") @Transactional public Map<String,Object> createAgentSession(@RequestBody Map<String,Object> body) {
        String capture=Objects.toString(body.getOrDefault("contentMarkdown",""),"").trim();
        if(capture.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"contentMarkdown is required");
        String selectedUseCase=normalizedUseCase(body.getOrDefault("useCase",useCase()));
        Map<String,Object> activeEpic=activeEpic(selectedUseCase);
        UUID recordId=UUID.randomUUID();
        String title=Objects.toString(body.getOrDefault("title", selectedUseCase.equals("LEARNING") ? "학습 재료" : "경험 기록"),"").trim();
        db.update("INSERT INTO record(id,user_id,title,content_markdown,tags_json) VALUES (?,?,?,?,?::jsonb)",recordId,userId(),title.isBlank()?"경험 기록":title,capture,json(body.getOrDefault("tags",List.of())));
        UUID sessionId=UUID.randomUUID();
        Map<String,Object> context=new LinkedHashMap<>(); context.put("recordIds",List.of(recordId.toString())); context.put("answers",new LinkedHashMap<>());
        db.update("INSERT INTO agent_session(id,user_id,epic_id,use_case,state,context_json) VALUES (?,?,?,?,'INTERPRETING',?::jsonb)",sessionId,userId(),activeEpic.get("id"),selectedUseCase,json(context));
        Map<String,Object> interpreted=interpretSession(sessionId,selectedUseCase,activeEpic,context);
        return saveSessionResponse(sessionId,interpreted);
    }

    @GetMapping("/agent-sessions/{id}") public Map<String,Object> getAgentSession(@PathVariable UUID id) {
        return sessionResponse(id);
    }

    @PostMapping("/agent-sessions/{id}/turns") @Transactional public Map<String,Object> agentTurn(@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Map<String,Object> session=lockedSession(id);
        if(!"NEEDS_INPUT".equals(session.get("state"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"Session is not awaiting input");
        Map<String,Object> context=parseObject(session.get("context"));
        Map<String,Object> answers=parseObject(context.get("answers"));
        String cardId=Objects.toString(body.getOrDefault("cardId",""),"").trim();
        if(cardId.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"cardId is required");
        List<?> cards=(List<?>)parseJsonValue(session.get("cards"),List.of());
        Map<?,?> card=cards.stream().filter(c -> cardId.equals(((Map<?,?>)c).get("id"))).map(c -> (Map<?,?>)c).findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,"Unknown card"));
        String value=required(body,"value").trim();
        if(value.length()>8000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Answer too long");
        if("source-check".equals(cardId) && !Set.of("confirm","replace","none").contains(value)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid evidence decision");
        if("facts-check".equals(cardId) && !Set.of("confirm","edit").contains(value)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid confirmation");
        if("free_text".equals(value)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Enter an answer first");
        if(Set.of("role","learning-level").contains(cardId)) {
            for(Object option:(List<?>)card.get("options")) {
                Map<?,?> choice=(Map<?,?>)option;
                if(value.equals(choice.get("id"))) { value=Objects.toString(choice.get("label")); break; }
            }
        }
        answers.put(cardId,value);
        if("additional-context".equals(cardId)) {
            UUID recordId=UUID.randomUUID();
            db.update("INSERT INTO record(id,user_id,title,content_markdown,tags_json) VALUES (?,?,?,?,'[]'::jsonb)",recordId,userId(),"대화에서 보완한 기록",value);
            context.put("recordIds",List.of(recordId.toString()));
            answers.remove("source-check");
            answers.remove("facts-check");
        }
        context.put("answers",answers);
        String selectedUseCase=normalizedUseCase(session.get("useCase"));
        Map<String,Object> activeEpic=activeEpic(selectedUseCase);
        boolean ready=answers.containsKey("role") || answers.containsKey("learning-level");
        ready=ready && "confirm".equals(answers.get("facts-check")) && "confirm".equals(answers.get("source-check"));
        if(ready) {
            Map<String,Object> proposalResult=generateForContext(Map.of("epicId",Objects.toString(activeEpic.get("id"))),context);
            List<?> proposals=(List<?>)proposalResult.getOrDefault("proposals",List.of());
            if(!proposals.isEmpty()) {
                Map<?,?> proposal=(Map<?,?>)proposals.get(0);
                UUID proposalId=UUID.fromString(proposal.get("id").toString());
                db.update("UPDATE agent_session SET state='PROPOSAL_PENDING',context_json=?::jsonb,proposal_id=?,pending_cards_json=?::jsonb,updated_at=now() WHERE id=? AND user_id=?",json(context),proposalId,json(List.of(Map.of("type","PROPOSAL","id","proposal","title",proposal.get("title"),"value",proposal))),id,userId());
                return sessionResponse(id);
            }
            // A successful HTTP response can still contain no usable proposals.
            // Do not send the user back to the same evidence confirmation card.
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "No usable proposal was generated; retry generation");
        }
        Map<String,Object> interpreted=interpretSession(id,selectedUseCase,activeEpic,context);
        db.update("UPDATE agent_session SET state=?,context_json=?::jsonb,pending_cards_json=?::jsonb,updated_at=now() WHERE id=? AND user_id=?",interpreted.getOrDefault("state","NEEDS_INPUT"),json(context),json(interpreted.getOrDefault("cards",List.of())),id,userId());
        return sessionResponse(id);
    }

    @PostMapping("/agent-sessions/{id}/approve") @Transactional public Map<String,Object> approveAgentSession(@PathVariable UUID id,@RequestBody(required=false) Map<String,Object> body) {
        Map<String,Object> session=lockedSession(id);
        if(!"PROPOSAL_PENDING".equals(session.get("state"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"No result awaiting review");
        Object proposalId=session.get("proposalId");
        if(proposalId==null) throw new ResponseStatusException(HttpStatus.CONFLICT,"No proposal is ready");
        Map<String,Object> decisionBody=new LinkedHashMap<>(body==null?Map.of():body);
        decisionBody.put("action",body==null?"ACCEPT":"ACCEPT_EDITED");
        Map<String,Object> result=decision(UUID.fromString(proposalId.toString()),decisionBody);
        db.update("UPDATE agent_session SET state='APPROVED',updated_at=now() WHERE id=? AND user_id=?",id,userId());
        return Map.of("sessionId",id,"state","APPROVED","result",result);
    }

    @PostMapping("/agent-sessions/{id}/reject") @Transactional public Map<String,Object> rejectAgentSession(@PathVariable UUID id,@RequestBody(required=false) Map<String,Object> body) {
        Map<String,Object> session=lockedSession(id);
        if(!"PROPOSAL_PENDING".equals(session.get("state"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"No result awaiting review");
        Object proposalId=session.get("proposalId");
        if(proposalId!=null) decision(UUID.fromString(proposalId.toString()),Map.of("action","REJECT","reason",body==null?"":body.getOrDefault("reason","")));
        db.update("UPDATE agent_session SET state='REJECTED',updated_at=now() WHERE id=? AND user_id=?",id,userId());
        return Map.of("sessionId",id,"state","REJECTED");
    }

    @PostMapping("/agent/quest-proposals") @Transactional public Map<String,Object> generate(@RequestBody Map<String,String> body) {
        return generateForContext(body,Map.of());
    }
    private Map<String,Object> generateForContext(Map<String,String> body,Map<String,Object> context) {
        UUID epicId=UUID.fromString(body.get("epicId"));
        Map<String,Object> e;
        try { e=db.queryForMap("SELECT id,title,completion_criteria,use_case FROM epic WHERE id=? AND user_id=? AND status='ACTIVE'",epicId,userId()); }
        catch (org.springframework.dao.EmptyResultDataAccessException ex) { throw new NotFoundException(); }
        String selectedUseCase=normalizedUseCase(e.get("use_case"));
        UUID runId=UUID.randomUUID(); db.update("INSERT INTO agent_run(id,user_id,epic_id,status) VALUES (?,?,?,'RUNNING')",runId,userId(),epicId);
        String recordFilter=selectedUseCase.equals("LEARNING") ? "" : " AND NOT (tags_json @> '[\"learning-note\"]'::jsonb)";
        List<Map<String,Object>> rs=db.queryForList("SELECT id,title,content_markdown,version FROM record WHERE user_id=? AND deleted_at IS NULL"+recordFilter+" ORDER BY updated_at DESC LIMIT 20",userId());
        if(context.containsKey("recordIds")) {
            List<?> ids=(List<?>)context.get("recordIds");
            rs=ids.stream().map(id -> {
                Map<String,Object> r=new LinkedHashMap<>(record(UUID.fromString(id.toString())));
                r.put("content_markdown",r.get("contentMarkdown"));
                return r;
            }).toList();
        }
        List<Map<String,Object>> existingQuests=db.queryForList("SELECT title,description,status FROM quest WHERE user_id=? AND epic_id=? AND status IN ('TODO','IN_PROGRESS') ORDER BY created_at DESC LIMIT 20",userId(),epicId);
        List<Map<String,Object>> profileRows=db.queryForList("SELECT display_name AS \"displayName\",COALESCE(occupation,'') AS occupation,current_goal AS \"currentGoal\",experience_summary AS \"experienceSummary\",interests_json::text AS interests FROM user_profile WHERE user_id=?",userId());
        Map<String,Object> profile=profileRows.isEmpty()?Map.of("displayName","","occupation","","currentGoal","","experienceSummary","","interests","[]"):profileRows.get(0);
        try {
            byte[] requestBody=json(Map.of("runId",runId.toString(),"useCase",selectedUseCase,"userContext",Map.of("userId",userId(),"displayName",profile.get("displayName"),"occupation",profile.get("occupation"),"currentGoal",profile.get("currentGoal"),"experienceSummary",profile.get("experienceSummary"),"interests",parseJsonArray(profile.get("interests"))),"epic",Map.of("id",epicId.toString(),"title",e.get("title"),"completionCriteria",e.get("completion_criteria")),"records",rs.stream().map(r->Map.of("id",r.get("id").toString(),"title",r.get("title"),"contentMarkdown",r.get("content_markdown"),"version",r.get("version"))).toList(),"existingQuests",existingQuests,"answers",context.getOrDefault("answers",Map.of()))).getBytes(StandardCharsets.UTF_8);
            HttpRequest agentRequest=HttpRequest.newBuilder(URI.create(agentBaseUrl+"/internal/v1/quest-proposals/generate"))
                    .header("Content-Type","application/json")
                    .header("X-Internal-Api-Key",apiKey)
                    .timeout(java.time.Duration.ofSeconds(90)).POST(HttpRequest.BodyPublishers.ofByteArray(requestBody))
                    .build();
            HttpResponse<String> agentResponse=agent.send(agentRequest,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if(agentResponse.statusCode()==422)
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"No usable proposal was generated");
            if(agentResponse.statusCode()<200 || agentResponse.statusCode()>=300)
                throw new IllegalStateException("Agent API returned HTTP "+agentResponse.statusCode()+": "+agentResponse.body());
            Map response=new com.fasterxml.jackson.databind.ObjectMapper().readValue(agentResponse.body(),Map.class);
            for(Object o:(List)response.getOrDefault("proposals",List.of())) {
                Map p=(Map)o; UUID pid=UUID.randomUUID();
                List<String> steps=stringList(p.get("steps"));
                String criteria=requiredText(p.get("completionCriteria"),"completionCriteria");
                if(steps.size()<2 || steps.size()>5) throw new IllegalArgumentException("Proposal must include 2 to 5 actionable steps");
                db.update("INSERT INTO quest_proposal(id,run_id,epic_id,user_id,title,description,rationale,steps_json,completion_criteria,result_markdown) VALUES (?,?,?,?,?,?,?,?::jsonb,?,?)",pid,runId,epicId,userId(),requiredText(p.get("title"),"title"),requiredText(p.get("description"),"description"),p.getOrDefault("rationale",""),json(steps),criteria,requiredText(p.get("resultMarkdown"),"resultMarkdown"));
                int savedEvidence=0;
                for(Object ev:(List)p.getOrDefault("evidence",List.of())) {
                    Map v=(Map)ev;
                    String excerpt=Objects.toString(v.get("excerpt"),"");
                    boolean valid=rs.stream().anyMatch(r -> r.get("id").toString().equals(Objects.toString(v.get("recordId"))) && r.get("version").toString().equals(Objects.toString(v.get("recordVersion"))) && !excerpt.isBlank() && r.get("content_markdown").toString().contains(excerpt));
                    if(!valid) continue;
                    savedEvidence+=db.update("INSERT INTO proposal_evidence(proposal_id,record_id,record_version,excerpt) SELECT ?,id,version,? FROM record WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL ON CONFLICT DO NOTHING",
                            pid,v.get("excerpt"),UUID.fromString(v.get("recordId").toString()),userId(),v.get("recordVersion"));
                }
                if(savedEvidence==0) {
                    log.warn("Proposal rejected: no matching source evidence run_id={} proposal_id={}",runId,pid);
                    db.update("DELETE FROM quest_proposal WHERE id=?",pid);
                }
            }
            db.update("UPDATE agent_run SET status='SUCCEEDED' WHERE id=?",runId);
            return Map.of("runId",runId,"status","SUCCEEDED","proposals",proposalRows("run_id",runId));
        } catch(Exception ex) {
            db.update("UPDATE agent_run SET status='FAILED',error_code=? WHERE id=?",ex.getClass().getSimpleName(),runId);
            if(ex instanceof ResponseStatusException responseError) throw responseError;
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Agent request failed",ex);
        }
    }
    @GetMapping("/quest-proposals") public List<Map<String,Object>> proposals() { return proposalRows("user_id",userId()); }
    @GetMapping("/quest-proposals/{id}") public Map<String,Object> proposal(@PathVariable UUID id) {
        Map<String,Object> p;
        try { p=db.queryForMap("SELECT id,run_id AS \"runId\",epic_id AS \"epicId\",title,description,rationale,steps_json::text AS steps,completion_criteria AS \"completionCriteria\",result_markdown AS \"resultMarkdown\",status FROM quest_proposal WHERE id=? AND user_id=?",id,userId()); }
        catch(Exception ex) { throw new NotFoundException(); }
        p.put("steps",stringList(p.get("steps")));
        p.put("evidence",db.queryForList("SELECT pe.record_id AS \"recordId\",pe.record_version AS \"recordVersion\",pe.excerpt,r.title AS \"recordTitle\" FROM proposal_evidence pe JOIN record r ON r.id=pe.record_id WHERE pe.proposal_id=?",id));
        return p;
    }
    @PostMapping("/quest-proposals/{id}/decisions") @Transactional public Map<String,Object> decision(@PathVariable UUID id,@RequestBody Map<String,Object> b) {
        db.queryForList("SELECT id FROM agent_session WHERE proposal_id=? AND user_id=? FOR UPDATE",id,userId());
        Map<String,Object> p;
        try { p=db.queryForMap("SELECT * FROM quest_proposal WHERE id=? AND user_id=? FOR UPDATE",id,userId()); }
        catch (org.springframework.dao.EmptyResultDataAccessException ex) { throw new NotFoundException(); }
        String action=Objects.toString(b.get("action"),"");
        if(!"PENDING".equals(p.get("status"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"Proposal already decided");
        if("REJECT".equals(action)) { db.update("UPDATE quest_proposal SET status='REJECTED',decision_reason=? WHERE id=?",b.get("reason"),id); db.update("UPDATE agent_session SET state='REJECTED',updated_at=now() WHERE proposal_id=? AND user_id=?",id,userId()); return Map.of("proposalId",id,"status","REJECTED"); }
        if(!"ACCEPT".equals(action)&&!"ACCEPT_EDITED".equals(action)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid action");
        String title="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedTitle",p.get("title"))):Objects.toString(p.get("title"));
        String desc="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedDescription",p.get("description"))):Objects.toString(p.get("description"));
        List<String> steps="ACCEPT_EDITED".equals(action)?stringList(b.getOrDefault("editedSteps",p.get("steps_json"))):stringList(p.get("steps_json"));
        String criteria="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedCompletionCriteria",p.get("completion_criteria"))):Objects.toString(p.get("completion_criteria"));
        if(title.isBlank() || desc.isBlank() || steps.size()<2 || steps.size()>5 || criteria.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Quest title, objective, 2 to 5 steps, and completion criteria are required");
        String resultMarkdown="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedResultMarkdown",p.get("result_markdown")),""):Objects.toString(p.get("result_markdown"),"");
        if(!Objects.toString(p.get("result_markdown"),"").isBlank() && resultMarkdown.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Result body is required");
        db.queryForList("SELECT r.id FROM record r JOIN proposal_evidence pe ON pe.record_id=r.id WHERE pe.proposal_id=? ORDER BY r.id FOR SHARE OF r",id);
        Integer stale=db.queryForObject("SELECT count(*) FROM proposal_evidence pe JOIN record r ON r.id=pe.record_id WHERE pe.proposal_id=? AND (r.version<>pe.record_version OR r.deleted_at IS NOT NULL)",Integer.class,id);
        if(stale!=null && stale>0) throw new ResponseStatusException(HttpStatus.CONFLICT,"Evidence changed; generate a new result");
        UUID q=UUID.randomUUID(); db.update("INSERT INTO quest(id,user_id,epic_id,source_proposal_id,title,description,steps_json,completion_criteria,result_markdown) VALUES (?,?,?,?,?, ?,?::jsonb,?,?)",q,userId(),p.get("epic_id"),id,title,desc,json(steps),criteria,resultMarkdown);
        db.update("INSERT INTO quest_evidence(quest_id,record_id,record_version) SELECT ?,record_id,record_version FROM proposal_evidence WHERE proposal_id=?",q,id);
        db.update("INSERT INTO quest_event(quest_id,event_type,new_status) VALUES (?,'CREATED','TODO')",q);
        db.update("UPDATE quest_proposal SET status='ACCEPTED' WHERE id=?",id);
        db.update("UPDATE agent_session SET state='APPROVED',approved_context_json=context_json,updated_at=now() WHERE proposal_id=? AND user_id=?",id,userId());
        return Map.of("proposalId",id,"questId",q,"status","ACCEPTED");
    }
    @GetMapping("/quests") public List<Map<String,Object>> quests() {
        List<Map<String,Object>> rows=db.queryForList("SELECT id,epic_id AS \"epicId\",title,description,steps_json::text AS steps,completion_criteria AS \"completionCriteria\",result_markdown AS \"resultMarkdown\",status FROM quest WHERE user_id=? ORDER BY created_at DESC",userId());
        rows.forEach(row->{
            row.put("steps",stringList(row.get("steps")));
            row.put("recordIds",db.queryForList("SELECT record_id FROM quest_evidence WHERE quest_id=? ORDER BY record_id",row.get("id")).stream().map(evidence->evidence.get("record_id").toString()).toList());
        });
        return rows;
    }
    private List<Map<String,Object>> proposalRows(String filterColumn,Object filterValue) {
        if(!Set.of("run_id","user_id").contains(filterColumn)) throw new IllegalArgumentException("Unsupported proposal filter");
        List<Map<String,Object>> rows=db.queryForList("SELECT id,run_id AS \"runId\",epic_id AS \"epicId\",title,description,rationale,steps_json::text AS steps,completion_criteria AS \"completionCriteria\",result_markdown AS \"resultMarkdown\",status FROM quest_proposal WHERE "+filterColumn+"=? ORDER BY created_at DESC",filterValue);
        rows.forEach(row->{ row.put("steps",stringList(row.get("steps"))); row.put("evidence",db.queryForList("SELECT pe.record_id AS \"recordId\",pe.record_version AS \"recordVersion\",pe.excerpt,r.title AS \"recordTitle\" FROM proposal_evidence pe JOIN record r ON r.id=pe.record_id WHERE pe.proposal_id=?",row.get("id"))); });
        return rows;
    }

    private String useCase() {
        try { return normalizedUseCase(db.queryForObject("SELECT use_case FROM user_profile WHERE user_id=?",String.class,userId())); }
        catch(Exception ignored) { return "CAREER"; }
    }

    private Map<String,Object> activeEpic(String selectedUseCase) {
        List<Map<String,Object>> rows=db.queryForList("SELECT id,title,completion_criteria AS \"completionCriteria\",use_case AS \"useCase\" FROM epic WHERE user_id=? AND status='ACTIVE' AND use_case=? ORDER BY created_at LIMIT 1",userId(),selectedUseCase);
        if(rows.isEmpty()) {
            String title=selectedUseCase.equals("LEARNING")?"개인 학습 로드맵 생성":"경력기술서 초안 완성";
            String criteria=selectedUseCase.equals("LEARNING")?"학습 목표와 현재 수준에 맞는 실행 가능한 학습 단계를 정리한다.":"프로젝트별 역할, 문제 해결 과정, 실행한 행동과 검증 가능한 성과를 원본 경험 기록에 근거해 경력기술서 초안으로 정리한다.";
            db.update("INSERT INTO epic(user_id,title,completion_criteria,use_case) VALUES (?,?,?,?)",userId(),title,criteria,selectedUseCase);
            rows=db.queryForList("SELECT id,title,completion_criteria AS \"completionCriteria\",use_case AS \"useCase\" FROM epic WHERE user_id=? AND status='ACTIVE' AND use_case=? ORDER BY created_at DESC LIMIT 1",userId(),selectedUseCase);
        }
        return rows.get(0);
    }

    private Map<String,Object> interpretSession(UUID sessionId,String selectedUseCase,Map<String,Object> activeEpic,Map<String,Object> context) {
        List<String> ids=((List<?>)context.getOrDefault("recordIds",List.of())).stream().map(Object::toString).toList();
        List<Map<String,Object>> records=ids.stream().map(id -> record(UUID.fromString(id))).toList();
        Map<String,Object> payload=new LinkedHashMap<>(); payload.put("sessionId",sessionId.toString()); payload.put("useCase",selectedUseCase); payload.put("userContext",profile()); payload.put("records",records); payload.put("answers",context.getOrDefault("answers",Map.of()));
        try {
            HttpRequest request=HttpRequest.newBuilder(URI.create(agentBaseUrl+"/internal/v1/agent-sessions/interpret"))
                    .header("Content-Type","application/json").header("X-Internal-Api-Key",apiKey)
                    .timeout(java.time.Duration.ofSeconds(90)).POST(HttpRequest.BodyPublishers.ofString(json(payload),StandardCharsets.UTF_8)).build();
            HttpResponse<String> response=agent.send(request,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if(response.statusCode()<200 || response.statusCode()>=300) throw new IllegalStateException("Agent interpret returned HTTP "+response.statusCode());
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(response.body(),Map.class);
        } catch(Exception ex) { throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Agent conversation failed",ex); }
    }

    private Map<String,Object> saveSessionResponse(UUID sessionId,Map<String,Object> interpreted) {
        String state=Objects.toString(interpreted.getOrDefault("state","NEEDS_INPUT"),"NEEDS_INPUT");
        db.update("UPDATE agent_session SET state=?,pending_cards_json=?::jsonb,updated_at=now() WHERE id=? AND user_id=?",state,json(interpreted.getOrDefault("cards",List.of())),sessionId,userId());
        return sessionResponse(sessionId);
    }

    private Map<String,Object> sessionResponse(UUID id) {
        Map<String,Object> row=sessionRow(id);
        Map<String,Object> result=new LinkedHashMap<>(); result.put("sessionId",row.get("id")); result.put("useCase",row.get("useCase")); result.put("state",row.get("state"));
        Map<String,Object> npc=new LinkedHashMap<>(); npc.put("name","리콜 가이드"); npc.put("message",row.get("message")); result.put("npc",npc);
        result.put("cards",parseJsonValue(row.get("cards"),List.of()));
        if(row.get("proposalId")!=null) result.put("proposalId",row.get("proposalId"));
        return result;
    }

    private Map<String,Object> lockedSession(UUID id) {
        if(db.queryForList("SELECT id FROM agent_session WHERE id=? AND user_id=? FOR UPDATE",id,userId()).isEmpty()) throw new NotFoundException();
        return sessionRow(id);
    }
    @GetMapping("/agent-sessions/latest") public Map<String,Object> latestSession() {
        List<Map<String,Object>> rows=db.queryForList("SELECT id FROM agent_session WHERE user_id=? AND use_case=? AND state IN ('NEEDS_INPUT','PROPOSAL_PENDING') ORDER BY updated_at DESC LIMIT 1",userId(),useCase());
        return rows.isEmpty()?Map.of():sessionResponse((UUID)rows.get(0).get("id"));
    }
    private Map<String,Object> sessionRow(UUID id) {
        try {
            Map<String,Object> row=db.queryForMap("SELECT id,use_case AS \"useCase\",state,context_json::text AS context,pending_cards_json::text AS cards,proposal_id AS \"proposalId\" FROM agent_session WHERE id=? AND user_id=?",id,userId());
            List<?> cards=(List<?>)parseJsonValue(row.get("cards"),List.of());
            String message=cards.isEmpty()?"계속해서 경험을 정리해볼게요.":Objects.toString(((Map<?,?>)cards.get(0)).get("title"),"");
            row.put("message",message); return row;
        } catch(Exception ex) { throw new NotFoundException(); }
    }

    private static Map<String,Object> parseObject(Object value) {
        if(value instanceof Map<?,?> map) { Map<String,Object> result=new LinkedHashMap<>(); map.forEach((k,v)->result.put(Objects.toString(k),v)); return result; }
        if(value==null || value.toString().isBlank()) return new LinkedHashMap<>();
        try { return new com.fasterxml.jackson.databind.ObjectMapper().readValue(value.toString(),new com.fasterxml.jackson.core.type.TypeReference<Map<String,Object>>(){}); }
        catch(Exception ex) { return new LinkedHashMap<>(); }
    }

    private static Object parseJsonValue(Object value,Object fallback) {
        if(value==null) return fallback;
        if(value instanceof Collection<?> || value instanceof Map<?,?>) return value;
        try { return new com.fasterxml.jackson.databind.ObjectMapper().readValue(value.toString(),Object.class); }
        catch(Exception ex) { return fallback; }
    }

    private static String normalizedUseCase(Object value) {
        String result=Objects.toString(value,"CAREER").trim().toUpperCase(Locale.ROOT);
        if(!Set.of("CAREER","LEARNING").contains(result)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"useCase must be CAREER or LEARNING");
        return result;
    }
    private Map<String,Object> record(UUID id) { try { return db.queryForMap("SELECT id,title,content_markdown AS \"contentMarkdown\",tags_json AS tags,version,created_at AS \"createdAt\" FROM record WHERE id=? AND user_id=? AND deleted_at IS NULL",id,userId()); } catch(Exception e) { throw new NotFoundException(); } }
    private static String required(Map<String,Object>b,String k) { Object v=b.get(k); if(v==null||v.toString().isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,k+" is required"); return v.toString(); }
    private static String requiredText(Object value,String field) { if(value==null||value.toString().isBlank()) throw new IllegalArgumentException(field+" is required"); return value.toString(); }
    private static List<String> stringList(Object value) {
        if(value instanceof Collection<?> values) return values.stream().map(Objects::toString).map(String::trim).filter(s->!s.isEmpty()).toList();
        if(value==null||value.toString().isBlank()) return List.of();
        try { return new com.fasterxml.jackson.databind.ObjectMapper().readValue(value.toString(),new com.fasterxml.jackson.core.type.TypeReference<List<String>>(){}); }
        catch(Exception ex) { throw new IllegalArgumentException("Invalid steps JSON",ex); }
    }
    private static List<?> parseJsonArray(Object value) {
        try { return new com.fasterxml.jackson.databind.ObjectMapper().readValue(Objects.toString(value,"[]"),new com.fasterxml.jackson.core.type.TypeReference<List<Object>>(){}); }
        catch(Exception ex) { return List.of(); }
    }
    private static String json(Object o) { try { return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(o); } catch(Exception e) { throw new IllegalArgumentException(e); } }
    @ResponseStatus(HttpStatus.NOT_FOUND) static class NotFoundException extends RuntimeException {}
}
