document.addEventListener('DOMContentLoaded', () => {
  const pricingButtons = document.querySelectorAll('.select-pricing');
  const pricingCards = document.querySelectorAll('.pricing-card');
  const applyForm = document.getElementById('applyForm');
  const selectedPlanInput = document.getElementById('selectedPlan');
  const toast = document.getElementById('toast');
  const toastText = toast.querySelector('span');

  // Input elements
  const submitBtn = document.getElementById('submitBtn');
  const formLoading = document.getElementById('form-loading');

  // Modal elements
  const paymentModal = document.getElementById('payment-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const goToPricingBtn = document.getElementById('go-to-pricing-btn');

  // Result elements
  const resultSection = document.getElementById('result-section');
  const resultCard = document.querySelector('.result-card');
  const imagesWrapper = document.querySelector('.result-images-wrapper');
  const resultTitle = document.getElementById('result-title');
  const resultContentBody = document.getElementById('result-content-body');
  const copyBtn = document.getElementById('copy-btn');
  let lastContentType = null;

  // Pricing selection logic
  pricingButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const planName = button.getAttribute('data-plan');
      const targetCard = button.closest('.pricing-card');
      
      // Toggle visual Selected Ring
      pricingCards.forEach(card => card.classList.remove('selected'));
      if (targetCard) {
        targetCard.classList.add('selected');
      }
      
      // Auto-set plan name in hidden input
      if (selectedPlanInput) {
        selectedPlanInput.value = planName;
        selectedPlanInput.parentElement.style.display = 'block';
      }

      // Auto-toggle content type radio based on selected plan
      const radioBlog = document.querySelector('input[name="contentType"][value="blog"]');
      const radioThread = document.querySelector('input[name="contentType"][value="thread"]');
      
      if (planName.includes('블로그') && !planName.includes('스레드')) {
        if (radioBlog) radioBlog.checked = true;
      } else if (planName.includes('스레드') && !planName.includes('블로그')) {
        if (radioThread) radioThread.checked = true;
      }
    });
  });

  // Smooth scroll helper for all anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Show Toast Helper
  function showToast(message, isSuccess = true) {
    if (toast) {
      toastText.innerText = message;
      toast.style.background = isSuccess ? '#10b981' : '#ef4444';
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3500);
    }
  }

  // Close payment modal helper
  function closeModal() {
    if (paymentModal) {
      paymentModal.classList.remove('show');
    }
  }

  // Modal event listeners
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (goToPricingBtn) goToPricingBtn.addEventListener('click', closeModal);
  if (paymentModal) {
    paymentModal.addEventListener('click', (e) => {
      if (e.target === paymentModal) closeModal();
    });
  }

  // Copy text to clipboard logic
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const textToCopy = lastContentType === 'thread'
        ? resultContentBody.innerText
        : `${resultTitle.innerText}\n\n${resultContentBody.innerText}`;
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          복사 완료!
        `;
        copyBtn.style.background = '#059669';
        
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.style.background = '';
        }, 2000);
      }).catch(err => {
        showToast('클립보드 복사에 실패했습니다.', false);
        console.error('Copy failed:', err);
      });
    });
  }

  // Lead Form submission handler (triggers backend AI integration)
  if (applyForm) {
    applyForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Read form values
      const userName = document.getElementById('userName').value;
      const userEmail = document.getElementById('userEmail').value;
      const userJob = document.getElementById('userJob').value;
      const contentType = document.querySelector('input[name="contentType"]:checked').value;
      const contentGoal = document.querySelector('input[name="contentGoal"]:checked').value;
      const contentLink = document.getElementById('contentLink').value;
      const contentRequest = document.getElementById('contentRequest').value;

      // Loading state: ON
      if (formLoading) formLoading.style.display = 'flex';
      if (submitBtn) submitBtn.disabled = true;
      if (resultSection) resultSection.style.display = 'none'; // hide previous results

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userName,
            userEmail,
            userJob,
            contentType,
            contentGoal,
            contentLink,
            contentRequest
          })
        });

        const data = await response.json();

        // Loading state: OFF
        if (formLoading) formLoading.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;

        if (response.ok && data.success) {
          // If a warning message exists (e.g., text retry failure notification)
          if (data.warning_message) {
            showToast(data.warning_message, false);
          }

          // Fill text results
          lastContentType = contentType;
          if (contentType === 'thread') {
            // Threads posts have no title in the UI - body only.
            resultTitle.style.display = 'none';
          } else {
            resultTitle.style.display = '';
            resultTitle.innerText = data.title;
          }

          let bodyText = data.content;
          if (data.hashtags) {
            bodyText += `\n\n${data.hashtags}`;
          }
          resultContentBody.innerText = bodyText;

          // Toggle layout and image grid according to image count (0 images for thread)
          const imgCount = data.images ? data.images.length : 0;
          
          if (imgCount === 0) {
            // Thread case: Hide image container and expand text box to full width (1fr)
            if (imagesWrapper) imagesWrapper.style.display = 'none';
            if (resultCard) resultCard.style.gridTemplateColumns = '1fr';
          } else {
            // Blog case: Show images and restore 2-column layout (1.1fr 1fr)
            if (imagesWrapper) imagesWrapper.style.display = 'flex';
            if (resultCard) resultCard.style.gridTemplateColumns = '1.1fr 1fr';

            const imagesGrid = document.getElementById('result-images-grid');
            if (imagesGrid) {
              imagesGrid.innerHTML = '';
              imagesGrid.style.gridTemplateColumns = imgCount > 1 ? 'repeat(2, 1fr)' : '1fr';

              data.images.forEach((imgObj, idx) => {
                const cardId = `img-card-${idx}`;
                const btnId = `dl-btn-${idx}`;
                
                let imgCardHtml = '';
                
                if (imgObj.url === 'error') {
                  // Render error block inside card container, omit download button
                  imgCardHtml = `
                    <div class="img-card-error" id="${cardId}">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                      <span style="font-weight:600;">이미지 생성에 실패했습니다.</span>
                      <span style="font-size:12.5px; opacity:0.8; line-height:1.4;">잠시 후 다시 시도해주세요.</span>
                      <span style="font-size:11px; opacity:0.5; margin-top:8px; line-height:1.3; overflow:hidden; text-overflow:ellipsis; max-width:100%; white-space:nowrap;" title="${imgObj.prompt || ''}">프롬프트: "${imgObj.prompt || ''}"</span>
                    </div>
                  `;
                  imagesGrid.insertAdjacentHTML('beforeend', imgCardHtml);
                } else {
                  // Standard visual rendering
                  imgCardHtml = `
                    <div class="img-card" id="${cardId}" style="display: flex; flex-direction: column; gap: 14px;">
                      <div class="img-container" style="border-radius: 20px; overflow: hidden; border: 1px solid var(--border-color); aspect-ratio: 4/3; background: #0c0e14; position: relative;">
                        <img src="${imgObj.url}" alt="AI Match Image ${idx + 1}" style="width: 100%; height: 100%; object-fit: cover;">
                      </div>
                      <button id="${btnId}" class="btn btn-secondary" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 18px; font-size: 14px; width: 100%;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        이미지 ${imgCount > 1 ? `${idx + 1} ` : ''}다운로드
                      </button>
                    </div>
                  `;
                  imagesGrid.insertAdjacentHTML('beforeend', imgCardHtml);
                  
                  // Bind download event
                  const dlBtn = document.getElementById(btnId);
                  if (dlBtn) {
                    dlBtn.addEventListener('click', async () => {
                      try {
                        const imgResponse = await fetch(imgObj.url, { mode: 'cors' });
                        const blob = await imgResponse.blob();
                        const blobUrl = window.URL.createObjectURL(blob);
                        
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = blobUrl;
                        a.download = `ai-content-image-${Date.now()}-${idx + 1}.jpg`;
                        document.body.appendChild(a);
                        a.click();
                        
                        window.URL.revokeObjectURL(blobUrl);
                        document.body.removeChild(a);
                        showToast('이미지 다운로드가 완료되었습니다!');
                      } catch (err) {
                        console.warn('CORS restriction. Opening image in new tab for manual download...');
                        window.open(imgObj.url, '_blank');
                      }
                    });
                  }
                }
              });
            }
          }

          // Render result section
          resultSection.style.display = 'block';
          
          // Scroll smoothly to results
          setTimeout(() => {
            resultSection.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }, 100);

          showToast(data.warning_message ? '임시 데이터가 제공되었습니다.' : '콘텐츠 생성이 성공적으로 완료되었습니다!');
        } else if (response.status === 403 && data.reason === 'limit_exceeded') {
          // Open pricing alert modal
          if (paymentModal) {
            paymentModal.classList.add('show');
          }
          showToast('무료 생성 횟수 한도가 초과되었습니다.', false);
        } else {
          showToast(data.error || '생성 도중 오류가 발생했습니다. 다시 시도해 주세요.', false);
        }
      } catch (error) {
        if (formLoading) formLoading.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
        showToast('서버와의 통신이 실패했습니다.', false);
        console.error('Submission failed:', error);
      }
    });
  }

  // --- Fade-in on Scroll using Intersection Observer ---
  const fadeInSections = document.querySelectorAll('.fade-in-section');
  
  const observerOptions = {
    root: null,
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        if (entry.target.id !== 'result-section') {
          observer.unobserve(entry.target);
        }
      }
    });
  }, observerOptions);

  fadeInSections.forEach(section => {
    observer.observe(section);
  });
});
