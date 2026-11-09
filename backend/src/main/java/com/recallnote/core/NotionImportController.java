package com.recallnote.core;

import java.io.IOException;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class NotionImportController {
    private final NotionImportService service;
    public NotionImportController(NotionImportService service) { this.service = service; }

    @PostMapping(value = "/api/v1/imports/notion", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public NotionImportService.Result upload(@RequestParam("file") MultipartFile file,
            @RequestParam(value = "project", defaultValue = "") String project) throws IOException {
        if (file.getSize() > NotionZipReader.MAX_UPLOAD_BYTES) throw new MaxUploadSizeExceededException(NotionZipReader.MAX_UPLOAD_BYTES);
        if (file.isEmpty() || file.getOriginalFilename() == null || !file.getOriginalFilename().toLowerCase(Locale.ROOT).endsWith(".zip"))
            throw new IllegalArgumentException("Notion에서 Markdown & CSV 형식으로 내보낸 ZIP 파일을 선택해 주세요.");
        return service.importArchive(ApiController.CURRENT_USER.get(), file.getBytes(), project);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String,String>> invalid(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Map.of("message", error.getMessage()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String,String>> tooLarge() {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("message", "ZIP 파일은 4 MiB 이하로 선택해 주세요."));
    }
}
