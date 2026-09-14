import { Component } from "@angular/core";

@Component({
  selector: "app-terms",
  template: `
    <section class="prose-easy mx-auto max-w-3xl px-5 py-16">
      <h1 class="text-4xl font-semibold tracking-tight text-slate-50">Terms of Service</h1>
      <p class="mt-3 text-sm text-slate-500">Last updated: September 2026</p>

      <h2>1. The service</h2>
      <p>
        easyRAG ("the Service") lets you upload documents, index them and ask questions about them using third-party
        language models accessed with API keys you provide. The Service is operated by fpoiato.com ("we", "us").
      </p>

      <h2>2. Accounts</h2>
      <p>
        You need an account to use the Service. You are responsible for keeping your credentials secure and for all
        activity under your account. You must be at least 18 years old or have the authority to bind your organization.
      </p>

      <h2>3. Subscriptions and billing</h2>
      <p>
        Plans are billed monthly in advance based on the storage tier you choose. Storage is measured as the original size
        of documents currently in your account. If you exceed your tier you will be asked to delete documents or upgrade;
        uploads that would exceed the limit are rejected. Fees are non-refundable except where required by law.
      </p>

      <h2>4. Bring your own key</h2>
      <p>
        Model usage is performed with API keys you supply and is billed to you by the respective provider under that
        provider's terms. We store your keys encrypted and use them only to fulfil your requests. You may remove a key at
        any time.
      </p>

      <h2>5. Your content</h2>
      <p>
        You retain all rights to the documents you upload. You grant us a limited licence to store, process and index
        them solely to provide the Service to you. You warrant that you have the right to upload the content and that it
        does not violate any law or third-party right.
      </p>

      <h2>6. Acceptable use</h2>
      <ul>
        <li>No unlawful, infringing or malicious content.</li>
        <li>No attempts to access other accounts or to disrupt the Service.</li>
        <li>No automated scraping or reselling of the Service without written consent.</li>
      </ul>

      <h2>7. Availability</h2>
      <p>
        The Service is provided "as is". During the beta some components are paused during off-peak hours and short
        delays may occur. We do not guarantee uninterrupted availability and are not liable for indirect or consequential
        damages. Our total liability is limited to the fees you paid in the preceding three months.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may cancel at any time. We may suspend accounts that violate these terms. After cancellation your documents
        are deleted within 30 days.
      </p>

      <h2>9. Changes</h2>
      <p>We may update these terms; material changes are announced by email at least 14 days in advance.</p>

      <h2>10. Contact</h2>
      <p>Questions about these terms: <a class="text-cyan-300" href="mailto:hello@fpoiato.com">hello@fpoiato.com</a>.</p>
    </section>
  `,
})
export class Terms {}

@Component({
  selector: "app-privacy",
  template: `
    <section class="prose-easy mx-auto max-w-3xl px-5 py-16">
      <h1 class="text-4xl font-semibold tracking-tight text-slate-50">Privacy Policy</h1>
      <p class="mt-3 text-sm text-slate-500">Last updated: September 2026</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data</strong>: email address and authentication identifiers managed by Amazon Cognito.</li>
        <li><strong>Documents</strong>: the files you upload, their extracted text and vector embeddings.</li>
        <li><strong>Chat history</strong>: your questions, the generated answers and the passages cited.</li>
        <li><strong>API keys</strong>: the provider keys you choose to store, encrypted in AWS Secrets Manager.</li>
        <li><strong>Technical logs</strong>: request metadata used for security and debugging, retained for 7 days.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to operate the Service: authenticate you, index and search your documents, forward your questions to the
        model provider you selected, and bill your subscription. We do not sell data and do not use your documents to
        train models.
      </p>

      <h2>Where it lives</h2>
      <p>
        Data is stored in Amazon Web Services in the us-east-1 region: documents in Amazon S3 under a prefix unique to your
        account, indexes and history in Amazon RDS for PostgreSQL, keys in AWS Secrets Manager. All storage is encrypted
        at rest and all transport uses TLS.
      </p>

      <h2>Third parties</h2>
      <p>
        When you ask a question, the relevant passages and your message are sent to the model provider you configured
        (OpenAI, Anthropic, Google, xAI or OpenRouter) using your own key and under that provider's privacy terms. Optional
        document parsing may use LlamaCloud for PDF, Word and PowerPoint files.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Documents and chats are kept until you delete them or 30 days after cancelling your account. Deleting a document
        removes the file, its text and its embeddings immediately. Removing an API key deletes it from Secrets Manager.
      </p>

      <h2>Your rights</h2>
      <p>
        You can export or delete your data at any time from the workspace, or by emailing us. Residents of the EU, UK and
        Brazil (LGPD) may exercise access, rectification, portability and erasure rights by contacting us.
      </p>

      <h2>Contact</h2>
      <p>Privacy requests: <a class="text-cyan-300" href="mailto:hello@fpoiato.com">hello@fpoiato.com</a>.</p>
    </section>
  `,
})
export class Privacy {}
