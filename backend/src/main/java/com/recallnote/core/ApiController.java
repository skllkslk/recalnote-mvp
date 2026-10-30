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
    @GetMapping("/epics/active") public Map<String,Object> epic() { return db.queryForMap("SELECT id,title,completion_criteria AS \"completionCriteria\" FROM epic WHERE user_id=? AND status='ACTIVE' ORDER BY created_at LIMIT 1",userId()); }

    @PostMapping("/agent/quest-proposals") @Transactional public Map<String,Object> generate(@RequestBody Map<String,String> body) {
        UUID epicId=UUID.fromString(body.get("epicId"));
        Map<String,Object> e=db.queryForMap("SELECT id,title,completion_criteria FROM epic WHERE id=? AND user_id=? AND status='ACTIVE'",epicId,userId());
        UUID runId=UUID.randomUUID(); db.update("INSERT INTO agent_run(id,user_id,epic_id,status) VALUES (?,?,?,'RUNNING')",runId,userId(),epicId);
        List<Map<String,Object>> rs=db.queryForList("SELECT id,title,content_markdown,version FROM record WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20",userId());
        List<Map<String,Object>> existingQuests=db.queryForList("SELECT title,description,status FROM quest WHERE user_id=? AND epic_id=? AND status IN ('TODO','IN_PROGRESS') ORDER BY created_at DESC LIMIT 20",userId(),epicId);
        List<Map<String,Object>> profileRows=db.queryForList("SELECT COALESCE(occupation,'') AS occupation, interests_json::text AS interests FROM user_profile WHERE user_id=?",userId());
        Map<String,Object> profile=profileRows.isEmpty()?Map.of("occupation","","interests","[]"):profileRows.get(0);
        try {
            byte[] requestBody=json(Map.of("runId",runId.toString(),"userContext",Map.of("userId",userId(),"occupation",profile.get("occupation"),"interests",parseJsonArray(profile.get("interests"))),"epic",Map.of("id",epicId.toString(),"title",e.get("title"),"completionCriteria",e.get("completion_criteria")),"records",rs.stream().map(r->Map.of("id",r.get("id").toString(),"title",r.get("title"),"contentMarkdown",r.get("content_markdown"),"version",r.get("version"))).toList(),"existingQuests",existingQuests)).getBytes(StandardCharsets.UTF_8);
            HttpRequest agentRequest=HttpRequest.newBuilder(URI.create(agentBaseUrl+"/internal/v1/quest-proposals/generate"))
                    .header("Content-Type","application/json")
                    .header("X-Internal-Api-Key",apiKey)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(requestBody))
                    .build();
            HttpResponse<String> agentResponse=agent.send(agentRequest,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if(agentResponse.statusCode()<200 || agentResponse.statusCode()>=300)
                throw new IllegalStateException("Agent API returned HTTP "+agentResponse.statusCode()+": "+agentResponse.body());
            Map response=new com.fasterxml.jackson.databind.ObjectMapper().readValue(agentResponse.body(),Map.class);
            for(Object o:(List)response.getOrDefault("proposals",List.of())) {
                Map p=(Map)o; UUID pid=UUID.randomUUID();
                List<String> steps=stringList(p.get("steps"));
                String criteria=requiredText(p.get("completionCriteria"),"completionCriteria");
                if(steps.size()<2 || steps.size()>5) throw new IllegalArgumentException("Proposal must include 2 to 5 actionable steps");
                db.update("INSERT INTO quest_proposal(id,run_id,epic_id,user_id,title,description,rationale,steps_json,completion_criteria) VALUES (?,?,?,?,?,?,?,?::jsonb,?)",pid,runId,epicId,userId(),requiredText(p.get("title"),"title"),requiredText(p.get("description"),"description"),p.getOrDefault("rationale",""),json(steps),criteria);
                int savedEvidence=0;
                for(Object ev:(List)p.getOrDefault("evidence",List.of())) {
                    Map v=(Map)ev;
                    savedEvidence+=db.update("INSERT INTO proposal_evidence(proposal_id,record_id,record_version,excerpt) SELECT ?,id,version,? FROM record WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL ON CONFLICT DO NOTHING",
                            pid,v.get("excerpt"),UUID.fromString(v.get("recordId").toString()),userId(),v.get("recordVersion"));
                }
                if(savedEvidence==0) db.update("DELETE FROM quest_proposal WHERE id=?",pid);
            }
            db.update("UPDATE agent_run SET status='SUCCEEDED' WHERE id=?",runId);
            return Map.of("runId",runId,"status","SUCCEEDED","proposals",proposalRows("run_id",runId));
        } catch(Exception ex) { db.update("UPDATE agent_run SET status='FAILED',error_code=? WHERE id=?",ex.getClass().getSimpleName(),runId); throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Agent request failed",ex); }
    }
    @GetMapping("/quest-proposals") public List<Map<String,Object>> proposals() { return proposalRows("user_id",userId()); }
    @GetMapping("/quest-proposals/{id}") public Map<String,Object> proposal(@PathVariable UUID id) {
        Map<String,Object> p;
        try { p=db.queryForMap("SELECT id,run_id AS \"runId\",epic_id AS \"epicId\",title,description,rationale,steps_json::text AS steps,completion_criteria AS \"completionCriteria\",status FROM quest_proposal WHERE id=? AND user_id=?",id,userId()); }
        catch(Exception ex) { throw new NotFoundException(); }
        p.put("steps",stringList(p.get("steps")));
        p.put("evidence",db.queryForList("SELECT pe.record_id AS \"recordId\",pe.record_version AS \"recordVersion\",pe.excerpt,r.title AS \"recordTitle\" FROM proposal_evidence pe JOIN record r ON r.id=pe.record_id WHERE pe.proposal_id=?",id));
        return p;
    }
    @PostMapping("/quest-proposals/{id}/decisions") @Transactional public Map<String,Object> decision(@PathVariable UUID id,@RequestBody Map<String,Object> b) {
        Map<String,Object> p=db.queryForMap("SELECT * FROM quest_proposal WHERE id=? AND user_id=? FOR UPDATE",id,userId());
        String action=Objects.toString(b.get("action"),"");
        if(!"PENDING".equals(p.get("status"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"Proposal already decided");
        if("REJECT".equals(action)) { db.update("UPDATE quest_proposal SET status='REJECTED',decision_reason=? WHERE id=?",b.get("reason"),id); return Map.of("proposalId",id,"status","REJECTED"); }
        if(!"ACCEPT".equals(action)&&!"ACCEPT_EDITED".equals(action)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid action");
        String title="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedTitle",p.get("title"))):Objects.toString(p.get("title"));
        String desc="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedDescription",p.get("description"))):Objects.toString(p.get("description"));
        List<String> steps="ACCEPT_EDITED".equals(action)?stringList(b.getOrDefault("editedSteps",p.get("steps_json"))):stringList(p.get("steps_json"));
        String criteria="ACCEPT_EDITED".equals(action)?Objects.toString(b.getOrDefault("editedCompletionCriteria",p.get("completion_criteria"))):Objects.toString(p.get("completion_criteria"));
        if(title.isBlank() || desc.isBlank() || steps.size()<2 || steps.size()>5 || criteria.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Quest title, objective, 2 to 5 steps, and completion criteria are required");
        UUID q=UUID.randomUUID(); db.update("INSERT INTO quest(id,user_id,epic_id,source_proposal_id,title,description,steps_json,completion_criteria) VALUES (?,?,?,?,?, ?,?::jsonb,?)",q,userId(),p.get("epic_id"),id,title,desc,json(steps),criteria);
        db.update("INSERT INTO quest_evidence(quest_id,record_id,record_version) SELECT ?,record_id,record_version FROM proposal_evidence WHERE proposal_id=?",q,id);
        db.update("INSERT INTO quest_event(quest_id,event_type,new_status) VALUES (?,'CREATED','TODO')",q);
        db.update("UPDATE quest_proposal SET status='ACCEPTED' WHERE id=?",id);
        return Map.of("proposalId",id,"questId",q,"status","ACCEPTED");
    }
    @GetMapping("/quests") public List<Map<String,Object>> quests() {
        List<Map<String,Object>> rows=db.queryForList("SELECT id,epic_id AS \"epicId\",title,description,steps_json::text AS steps,completion_criteria AS \"completionCriteria\",status FROM quest WHERE user_id=? ORDER BY created_at DESC",userId());
        rows.forEach(row->row.put("steps",stringList(row.get("steps"))));
        return rows;
    }
    private List<Map<String,Object>> proposalRows(String filterColumn,Object filterValue) {
        if(!Set.of("run_id","user_id").contains(filterColumn)) throw new IllegalArgumentException("Unsupported proposal filter");
        List<Map<String,Object>> rows=db.queryForList("SELECT id,run_id AS \"runId\",epic_id AS \"epicId\",title,description,rationale,steps_json::text AS steps,completion_criteria AS \"completionCriteria\",status FROM quest_proposal WHERE "+filterColumn+"=? ORDER BY created_at DESC",filterValue);
        rows.forEach(row->{ row.put("steps",stringList(row.get("steps"))); row.put("evidence",db.queryForList("SELECT pe.record_id AS \"recordId\",pe.record_version AS \"recordVersion\",pe.excerpt,r.title AS \"recordTitle\" FROM proposal_evidence pe JOIN record r ON r.id=pe.record_id WHERE pe.proposal_id=?",row.get("id"))); });
        return rows;
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
